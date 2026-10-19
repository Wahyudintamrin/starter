/* ============================================================
   PHASE 4 — ADVANCED DIAGNOSTIC & TROUBLESHOOTING LABORATORY
   ------------------------------------------------------------
   Engine + UI. Data kasus ada di diagcases.js.
   Satu sumber kebenaran simulasi tetap: `Sim` (Phase 1) +
   Phase 2 node model + Phase 3 multimeter. Diagnosis membaca
   hasil pengukuran Phase 3 (tidak membuat multimeter baru).
   ============================================================ */
'use strict';

(() => {
    const CFG = window.DIAGNOSTIC_CONFIG || {};
    const CASES = window.DIAGNOSTIC_CASES || [];
    const KB = window.DIAGNOSTIC_KNOWLEDGE || {};
    const REPAIRS = window.REPAIR_ACTIONS || [];
    const TREE = window.DIAGNOSTIC_TREE;
    const LEAF = window.DIAGNOSTIC_TREE_LEAF_FAULTS || {};

    const $ = (id) => {
        try { return document.getElementById(id); } catch (e) { return null; }
    };

    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    /* ============================================================
       STATE
       ============================================================ */
    const D = {
        debugMode: !!CFG.debugMode,
        active: false,
        mode: 'GUIDED',                 // GUIDED | STANDARD | FREE
        caseObj: null,
        session: null,
        hypotheses: [],
        observations: [],
        confidence: 'LOW',
        diagnosisCorrect: false,
        finalDiagnosis: null,
        repairPerformed: null,          // repairId yang sudah dilakukan
        repairWasCorrect: null,
        verificationDone: false,
        verificationPassed: false,
        caseComplete: false,
        score: null,
        hintsUsed: 0,
        treeNode: TREE ? TREE.root : null,
        treePath: [],
        guidedStep: 0,
        startCount: 0,
        health: { starterRPM: 0, current: 0 },
        ended: false,
    };

    function knowledgeKey() {
        if (!D.caseObj) return null;
        const hf = D.caseObj.hiddenFault;
        return { component: hf.component, faultType: hf.faultType };
    }
    function activeKB() {
        const k = knowledgeKey();
        return k && KB[k.component] ? KB[k.component][k.faultType] : null;
    }
    function isDebug() { return D.debugMode || !!CFG.debugMode; }

    /* ============================================================
       FAULT INJECTION (hidden — tidak masuk Sim.activeFaults,
       agar tidak bocor lewat Phase 1 panel / Phase 3 record)
       ============================================================ */
    function applyFault(caseObj) {
        const kb = KB[caseObj.hiddenFault.component] &&
            KB[caseObj.hiddenFault.component][caseObj.hiddenFault.faultType];
        // Bersihkan semua fault & hook Phase 4 ke default dulu.
        if (typeof window.clearAllFaults === 'function') window.clearAllFaults(false);
        if (kb && kb.faultKey && FAULTS && FAULTS[kb.faultKey]) {
            FAULTS[kb.faultKey].apply();
        }
        const params = (kb && kb.params) || {};
        Object.keys(params).forEach(k => {
            if (Sim && Object.prototype.hasOwnProperty.call(Sim, k)) {
                Sim[k] = params[k];
            }
        });
    }

    function removeFault() {
        if (typeof window.clearAllFaults === 'function') window.clearAllFaults(false);
    }

    /* ============================================================
       OBSERVATION SNAPSHOT (evidence sistem)
       ============================================================ */
    function observeSystem(label) {
        if (!D.active || !D.caseObj) return null;
        const P2 = window.Phase2;
        const snap = {
            label: label || 'OBSERVE',
            time: Date.now(),
            systemState: Sim.systemState,
            ignition: Sim.ignitionState,
            relay: Sim.relayState,
            solenoid: Sim.solenoidState,
            pinion: Sim.pinionEngaged,
            starter: Sim.starterState,
            engine: Sim.engineState,
            starterRPM: Math.round(Sim.starterRPM),
            engineRPM: Math.round(Sim.engineRPM),
            starterCurrent: Math.round(Sim.starterCurrent),
            batteryPositive: P2 ? P2.getVoltageAtNode('batteryPositive') : Sim.batteryVoltage,
            starterPositive: P2 ? P2.getVoltageAtNode('starterPositive') : 0,
            groundVoltage: P2 ? P2.getVoltageAtNode('starterGround') : 0,
            batteryOk: Sim.batteryVoltage >= 12.3,
            faultClean: !Sim.activeFaults || Sim.activeFaults.length === 0,
            afterRepair: !!D.repairPerformed,
        };
        D.observations.push(snap);
        sessionSafe().observations.push(snap);
        logAction('OBSERVE_SYSTEM', { label: snap.label, systemState: snap.systemState, starterRPM: snap.starterRPM, afterRepair: snap.afterRepair });
        render();
        return snap;
    }

    function healthyObservation() {
        // Observasi sukses: starter benar-benar cranking (post-repair).
        for (let i = D.observations.length - 1; i >= 0; i--) {
            const o = D.observations[i];
            if (!o.afterRepair) continue;
            if (o.starter === 'CRANKING') return o;
        }
        return null;
    }

    /* ============================================================
       MEASUREMENT ENGINE (membaca Phase 3 records)
       ============================================================ */
    function measurements() {
        const recs = (window.Phase3 && window.Phase3.getRecords) ? window.Phase3.getRecords() : [];
        return recs.slice(D.startCount).filter(r => r && typeof r === 'object');
    }

    function normPair(a, b) {
        return [String(a || '').toLowerCase(), String(b || '').toLowerCase()].sort().join('|');
    }
    function sigPair(sig) {
        return normPair(sig.red, sig.black);
    }

    function recMatchesPair(rec, sig) {
        if (!rec.redProbe || !rec.blackProbe) return false;
        return normPair(rec.redProbe, rec.blackProbe) === sigPair(sig);
    }

    function recMatchesDuring(rec, sig) {
        if (!sig.during || sig.during === '*') return true;
        if (!Array.isArray(sig.during)) return String(sig.during) === rec.systemState;
        return sig.during.indexOf(rec.systemState) >= 0;
    }

    function recMatchesValue(rec, sig) {
        if (sig.ol) return !!rec.ol;
        if (rec.ol || rec.value === null || rec.value === undefined) return false;
        const v = Math.abs(rec.value);
        return v >= sig.min && v <= sig.max;
    }

    // Evaluasi SATU signature terhadap seluruh catatan pengukuran sesi.
    function evalSignature(sig) {
        const recs = measurements();
        let matched = false;
        let hasAny = false;
        let sample = null;
        for (let i = 0; i < recs.length; i++) {
            const r = recs[i];
            if (!recMatchesPair(r, sig)) continue;
            if (!recMatchesDuring(r, sig)) continue;
            hasAny = true;
            sample = sample || r;
            if (recMatchesValue(r, sig)) { matched = true; break; }
        }
        return { sig, matched, hasAny, sample, pair: sigPair(sig) };
    }

    // Evaluasi hipotesis (component + faultType) berdasarkan bukti.
    function evaluateHypothesisByKey(component, faultType) {
        const kb = KB[component] && KB[component][faultType];
        if (!kb) {
            return { verdict: 'INVALID', matched: 0, contrad: 0, total: 0, threshold: 1, confidence: 'LOW' };
        }
        const sigs = kb.signature || [];
        const results = sigs.map(evalSignature);
        const matched = results.filter(r => r.matched).length;
        // Kontradiksi: ada pengukuran pada pair yang TIDAK cocok (di luar rentang)
        // dan tidak ada pengukuran yang cocok pada pair tersebut.
        const contrad = results.filter(r => r.hasAny && !r.matched).length;
        const threshold = (D.caseObj && D.caseObj.difficulty === 'INTERMEDIATE') ? 2 : 1;
        let verdict = 'INSUFFICIENT';
        if (contrad > 0) verdict = 'NOT_SUPPORTED';
        else if (matched >= threshold) verdict = 'SUPPORTED';
        const confidence = confidenceFor(matched);
        return { verdict, matched, contrad, total: sigs.length, threshold, confidence };
    }

    function confidenceFor(matched) {
        if (matched >= CFG.confidenceCounts.HIGH) return 'HIGH';
        if (matched >= CFG.confidenceCounts.MEDIUM) return 'MEDIUM';
        return 'LOW';
    }

    // Bukti agregat untuk kasus aktif (per hipotesis kemungkinan).
    function evidenceSummary() {
        const k = knowledgeKey();
        if (!k || !KB[k.component] || !KB[k.component][k.faultType]) return [];
        const kb = KB[k.component][k.faultType];
        return (kb.signature || []).map(evalSignature).map(r => ({
            label: r.sig.label || (r.sig.mode + ' ' + r.pair),
            mode: r.sig.mode,
            pair: r.pair,
            during: Array.isArray(r.sig.during) ? r.sig.during.join('/') : r.sig.during,
            matched: r.matched,
            measured: r.hasAny,
            note: r.sig.note || '',
        }));
    }

    /* ============================================================
       HYPOTHESIS
       ============================================================ */
    function createHypothesis(data) {
        data = data || {};
        const component = String(data.component || '').trim();
        const faultType = String(data.faultType || '').trim();
        if (!KB[component] || !KB[component][faultType]) {
            return { ok: false, error: 'INVALID_FAULT', message: 'Komponen / jenis kerusakan tidak dikenal.' };
        }
        const evalRes = evaluateHypothesisByKey(component, faultType);
        const h = {
            id: 'H' + (D.hypotheses.length + 1),
            component,
            faultType,
            reason: String(data.reason || '').trim(),
            time: Date.now(),
            evaluation: evalRes,
            correct: !!(D.caseObj &&
                D.caseObj.expectedDiagnosis.component === component &&
                D.caseObj.expectedDiagnosis.faultType === faultType),
        };
        D.hypotheses.push(h);
        sessionSafe().hypotheses.push(h);
        // Sederhanakan: tingkatkan "logistics" bila bukan hipotesis pertama.
        if (!correctAndSupported(h)) {
            const k = knowledgeKey();
            if (k && !(k.component === component && k.faultType === faultType)) {
                // hipotesis yang tidak sesuai -> penalty kecil (diagnostic reasoning)
                applyPenalty('wrongHypothesis');
            }
        }
        logAction('CREATE_HYPOTHESIS', { component, faultType, verdict: evalRes.verdict });
        render();
        return { ok: true, hypothesis: h, evaluation: evalRes };
    }

    function correctAndSupported(h) {
        return h.correct && h.evaluation.verdict === 'SUPPORTED';
    }

    function evaluateHypothesis(idOrIdx) {
        let h = null;
        if (typeof idOrIdx === 'number') h = D.hypotheses[idOrIdx];
        else h = D.hypotheses.find(x => x.id === idOrIdx);
        if (!h) return null;
        h.evaluation = evaluateHypothesisByKey(h.component, h.faultType);
        render();
        return h.evaluation;
    }

    /* ============================================================
       EVIDENCE / CONFIDENCE / DIAGNOSIS
       ============================================================ */
    function getEvidence() {
        return evidenceSummary();
    }

    function calculateDiagnosticConfidence(component, faultType) {
        // Default: evaluasi hipotesis aktif terakhir (berdasarkan bukti),
        // bukan pilihan siswa secara subjektif.
        let k = knowledgeKey();
        if (component && faultType) {
            const res = evaluateHypothesisByKey(component, faultType);
            return { level: res.confidence, matched: res.matched, total: res.total, verdict: res.verdict };
        }
        if (!k) return { level: 'LOW', matched: 0, total: 0, verdict: 'INSUFFICIENT' };
        const res = evaluateHypothesisByKey(k.component, k.faultType);
        let level = res.confidence;
        if (D.repairWasCorrect && D.verificationPassed) level = 'CONFIRMED';
        return { level, matched: res.matched, total: res.total, verdict: res.verdict, correctFault: res.matched >= res.threshold };
    }

    function submitDiagnosis(data) {
        if (!D.active || !D.caseObj) {
            return { status: 'NO_CASE', message: 'Mulai kasus diagnosis terlebih dahulu.' };
        }
        data = data || {};
        const component = String(data.component || '').trim() || (D.hypotheses.length ? D.hypotheses[D.hypotheses.length - 1].component : '');
        const faultType = String(data.faultType || '').trim() || (D.hypotheses.length ? D.hypotheses[D.hypotheses.length - 1].faultType : '');
        if (!component || !faultType) {
            return { status: 'INVALID', message: 'Pilih komponen dan jenis kerusakan.' };
        }
        const res = evaluateHypothesisByKey(component, faultType);
        const kb = KB[component] && KB[component][faultType];
        const isCorrect = D.caseObj &&
            D.caseObj.expectedDiagnosis.component === component &&
            D.caseObj.expectedDiagnosis.faultType === faultType;

        if (res.verdict === 'NOT_SUPPORTED') {
            applyPenalty('wrongHypothesis');
            logAction('SUBMIT_DIAGNOSIS', { component, faultType, verdict: 'NOT_SUPPORTED' });
            return { status: 'NOT_SUPPORTED', message: 'HYPOTHESIS NOT SUPPORTED — hasil pengukuran Anda tidak mendukung kerusakan ini. Periksa bagian sirkuit lain.', evaluation: res };
        }
        if (res.verdict === 'INSUFFICIENT') {
            logAction('SUBMIT_DIAGNOSIS', { component, faultType, verdict: 'INSUFFICIENT' });
            return { status: 'INSUFFICIENT_EVIDENCE', message: 'INSUFFICIENT EVIDENCE — bukti belum cukup. Lakukan pengukuran tambahan sebelum menyimpulkan.', evaluation: res };
        }
        // SUPPORTED
        if (isCorrect) {
            D.diagnosisCorrect = true;
            D.finalDiagnosis = { component, faultType, label: kb ? kb.label : (component + ':' + faultType) };
            D.confidence = res.confidence;
            logAction('SUBMIT_DIAGNOSIS', { component, faultType, verdict: 'CORRECT' });
            render();
            return { status: 'CORRECT', message: 'STRONG EVIDENCE — diagnosis root cause benar: ' + (kb ? kb.label : '') + '.', evaluation: res };
        }
        applyPenalty('wrongHypothesis');
        logAction('SUBMIT_DIAGNOSIS', { component, faultType, verdict: 'WRONG' });
        return { status: 'WRONG', message: 'Bukti mendukung beberapa kemungkinan lain. Evaluasi ulang dengan pengukuran pembanding.', evaluation: res };
    }

    /* ============================================================
       REPAIR + VERIFICATION
       ============================================================ */
    function applyRepair(repairId) {
        if (!D.active || !D.caseObj) return { ok: false, error: 'NO_CASE' };
        if (!D.diagnosisCorrect) {
            return { ok: false, error: 'DIAGNOSIS_REQUIRED', message: 'Lengkapi diagnosis (root cause) sebelum melakukan repair.' };
        }
        const repair = REPAIRS.find(r => r.id === repairId);
        if (!repair) return { ok: false, error: 'INVALID_REPAIR', message: 'Tindakan repair tidak dikenal.' };

        const kb = activeKB();
        const correct = kb && kb.repairId === repairId;
        D.repairPerformed = repairId;
        D.repairWasCorrect = correct;

        sessionSafe().repairs.push({ id: repairId, correct, time: Date.now() });
        logAction('APPLY_REPAIR', { id: repairId, correct });

        if (correct) {
            removeFault();
        } else {
            applyPenalty('wrongRepair');
        }
        render();
        return { ok: true, correct, repair, message: correct
            ? 'Repair yang tepat. Sistem diperbaiki — sekarang VERIFIKASI hasilnya.'
            : 'Repair tidak sesuai dengan akar masalah. Sistem masih mengalami gangguan.' };
    }

    function verifyRepair() {
        if (!D.active || !D.caseObj) return { ok: false, reason: 'NO_CASE' };
        if (!D.diagnosisCorrect) return { ok: false, reason: 'DIAGNOSIS_REQUIRED' };
        if (!D.repairPerformed) return { ok: false, reason: 'REPAIR_REQUIRED' };
        if (!D.repairWasCorrect) {
            D.verificationDone = true;
            D.verificationPassed = false;
            const o = healthyObservation();
            return { ok: false, reason: 'REPAIR_WRONG', message: 'Sistem masih mengalami gangguan. Gunakan repair yang tepat.', observation: o };
        }

        const obs = healthyObservation();
        const pinionCase = D.caseObj.hiddenFault.component === 'pinion';
        const engineRotates = obs &&
            (obs.engine === 'CRANKING' || obs.engine === 'RUNNING' || obs.engineRPM > 0);

        const ok = !!obs && (pinionCase ? engineRotates : true);
        D.verificationDone = true;
        D.verificationPassed = ok;
        if (ok) D.confidence = 'CONFIRMED';

        logAction('VERIFY_REPAIR', { ok });
        if (ok) finalizeDiagnostic();
        else applyPenalty('repairNoVerify');
        render();
        return { ok, reason: ok ? 'VERIFIED' : 'VERIFICATION_FAILED', message: ok
            ? 'Verifikasi berhasil. Sistem kembali normal.'
            : 'Verifikasi gagal: perilaku sistem belum normal. Crank ulang untuk memastikan.', observation: obs };
    }

    /* ============================================================
       SCORING
       ============================================================ */
    const SCORE = CFG.scoring || {};
    let penaltiesTotal = 0;

    function applyPenalty(key) {
        const p = (CFG.penalties || {})[key] || 0;
        penaltiesTotal += p;
    }

    function distinctMeasurementPairs() {
        const seen = {};
        measurements().forEach(r => {
            if (r.redProbe && r.blackProbe) seen[normPair(r.redProbe, r.blackProbe)] = true;
        });
        return Object.keys(seen).length;
    }

    function repairsBeforeCorrect() {
        const reps = (D.session && D.session.repairs) || [];
        const firstCorrect = reps.findIndex(r => r.correct);
        return firstCorrect < 0 ? reps.length : firstCorrect;
    }

    function computeScore() {
        const kb = activeKB();
        const sigs = (kb && kb.signature) || [];
        const results = sigs.map(evalSignature);
        const matched = results.filter(r => r.matched).length;
        const total = Math.max(1, sigs.length);
        const distinct = distinctMeasurementPairs();

        const components = {};
        components.initialInspection = D.observations.length > 0 ? SCORE.initialInspection : 0;
        components.measurementProcedure = SCORE.measurementProcedure * clamp(distinct / total, 0, 1);
        components.correctMeasurements = SCORE.correctMeasurements * (matched / total);
        const supportedAtSubmit = D.diagnosisCorrect
            ? (evaluateHypothesisByKey(D.finalDiagnosis.component, D.finalDiagnosis.faultType).verdict === 'SUPPORTED') : false;
        components.diagnosticReasoning = D.diagnosisCorrect
            ? (supportedAtSubmit ? SCORE.diagnosticReasoning : SCORE.diagnosticReasoning * 0.6)
            : 0;
        components.rootCause = D.diagnosisCorrect ? SCORE.rootCause : 0;
        components.repairProcedure = D.repairWasCorrect
            ? (repairsBeforeCorrect() <= 1 ? SCORE.repairProcedure : SCORE.repairProcedure * 0.5)
            : (D.repairPerformed ? 0 : 0);
        components.verification = D.verificationPassed ? SCORE.verification : 0;

        const raw = Object.keys(components).reduce((s, k) => s + components[k], 0);
        // Penalti hint
        const hintLevel = D.hintsUsed >= 3 ? 3 : Math.max(1, D.hintsUsed);
        const hintPts = CFG.hints ? (CFG.hints[hintLevel] || 0) : 0;
        const hintPenalty = Math.min(15, D.hintsUsed * hintPts);
        const totalScore = clamp(Math.round(raw - penaltiesTotal - hintPenalty), 0, 100);

        D.score = { total: totalScore, components, penalties: { total: penaltiesTotal + hintPenalty, list: { wrongHypothesis: penaltiesTotal, hints: hintPenalty } } };
        if (D.session) D.session.score = totalScore;
        return D.score;
    }

    function getDiagnosticScore() {
        if (!D.score || !D.caseComplete) computeScore();
        return D.score;
    }

    /* ============================================================
       REPORT + SESSION
       ============================================================ */
    function sessionSafe() {
        if (!D.session) {
            D.session = {
                sessionId: 'P4-' + Date.now().toString(36),
                caseId: D.caseObj ? D.caseObj.id : '',
                mode: D.mode,
                startTime: Date.now(),
                endTime: null,
                measurements: [],
                hypotheses: [],
                tests: [],
                repairs: [],
                observations: [],
                finalDiagnosis: null,
                score: 0,
                status: 'IN_PROGRESS',
            };
        }
        return D.session;
    }

    function finalizeDiagnostic() {
        D.caseComplete = true;
        const s = sessionSafe();
        s.endTime = Date.now();
        s.finalDiagnosis = D.finalDiagnosis;
        s.score = computeScore().total;
        s.status = D.verificationPassed ? 'VERIFIED' : 'COMPLETED';
        s.hints = D.hintsUsed;
        saveSession(s);
        logAction('COMPLETE_CASE', { status: s.status, score: s.score });
    }

    function generateDiagnosticReport() {
        computeScore();
        const k = knowledgeKey();
        const kb = k && KB[k.component] ? KB[k.component][k.faultType] : null;
        const rep = REPAIRS.find(r => r.id === (kb ? kb.repairId : ''));
        const lastMeasures = measurements().slice(-6).map(r => ({
            test: r.test, red: r.redProbe, black: r.blackProbe,
            value: r.value, unit: r.unit, ol: !!r.ol, systemState: r.systemState,
        }));
        return {
            caseId: D.caseObj ? D.caseObj.id : null,
            title: D.caseObj ? D.caseObj.title : null,
            difficulty: D.caseObj ? D.caseObj.difficulty : null,
            customerComplaint: D.caseObj ? D.caseObj.customerComplaint : '',
            symptom: D.caseObj ? D.caseObj.symptom.description : '',
            measurements: lastMeasures,
            diagnosis: D.finalDiagnosis ? D.finalDiagnosis.label : null,
            rootCause: (k && kb) ? kb.label : null,
            repair: rep ? rep.label : (D.repairPerformed || null),
            verification: D.verificationPassed ? 'VERIFIED' : (D.verificationDone ? 'FAILED' : 'NOT_VERIFIED'),
            status: D.caseComplete ? (D.verificationPassed ? 'VERIFIED' : 'COMPLETED') : 'INCOMPLETE',
            score: D.score ? D.score.total : 0,
            confidence: D.confidence,
            timeSeconds: D.session ? Math.round((Date.now() - D.session.startTime) / 1000) : 0,
        };
    }

    function saveSession(s) {
        s = s || D.session;
        if (!s) return;
        let list = [];
        try {
            const raw = localStorage.getItem(CFG.storageKey);
            list = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(list)) list = [];
        } catch (e) { list = []; }
        const idx = list.findIndex(x => x && x.sessionId === s.sessionId);
        const copy = JSON.parse(JSON.stringify(s));
        if (idx >= 0) list[idx] = copy; else list.unshift(copy);
        try { localStorage.setItem(CFG.storageKey, JSON.stringify(list.slice(0, 50))); } catch (e) { /* quota kecil */ }
    }

    function getSavedSessions() {
        try {
            const raw = localStorage.getItem(CFG.storageKey);
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    /* ============================================================
       CASE LIFECYCLE
       ============================================================ */
    function startDiagnosticCase(caseId) {
        let caseObj = null;
        if (typeof caseId === 'object' && caseId && caseId.id) caseObj = caseId;
        else if (typeof caseId === 'number') caseObj = CASES[caseId];
        else caseObj = CASES.find(c => c.id === caseId);
        if (!caseObj) {
            if (CASES.length) caseObj = CASES[0];
        }
        if (!caseObj) return { ok: false, error: 'NO_CASES' };

        // Simpan sesi sebelumnya yang belum selesai.
        saveSession();
        D.active = true;
        D.caseObj = caseObj;
        D.hypotheses = [];
        D.observations = [];
        D.confidence = 'LOW';
        D.diagnosisCorrect = false;
        D.finalDiagnosis = null;
        D.repairPerformed = null;
        D.repairWasCorrect = null;
        D.verificationDone = false;
        D.verificationPassed = false;
        D.caseComplete = false;
        D.score = null;
        D.hintsUsed = 0;
        D.treeNode = TREE ? TREE.root : null;
        D.treePath = [];
        D.guidedStep = 0;
        D.ended = false;
        penaltiesTotal = 0;
        D.session = {
            sessionId: 'P4-' + Date.now().toString(36),
            caseId: caseObj.id,
            mode: D.mode,
            startTime: Date.now(),
            endTime: null,
            measurements: [],
            hypotheses: [],
            tests: [],
            repairs: [],
            observations: [],
            finalDiagnosis: null,
            score: 0,
            status: 'IN_PROGRESS',
        };

        // Bersihkan instrumen simulasi & multimeter untuk sesi yang bersih.
        if (typeof window.resetSimulation === 'function') window.resetSimulation();
        if (window.Phase3 && typeof window.Phase3.resetMultimeter === 'function') window.Phase3.resetMultimeter();

        // Suntikkan fault tersembunyi (tidak masuk Sim.activeFaults).
        applyFault(caseObj);
        // Setelah injeksi, pastikan sistem mati & aman untuk pengukuran awal.
        if (typeof window.setIgnition === 'function') window.setIgnition('OFF');

        D.startCount = (window.Phase3 && window.Phase3.getRecords) ? window.Phase3.getRecords().length : 0;
        logAction('START_CASE', { caseId: caseObj.id, difficulty: caseObj.difficulty, mode: D.mode });
        render();
        return { ok: true, caseObj };
    }

    function startRandomCase(difficulty) {
        let pool = CASES;
        if (difficulty) pool = CASES.filter(c => c.difficulty === difficulty);
        if (!pool.length) pool = CASES;
        const pick = pool[Math.floor(Math.random() * pool.length)];
        return startDiagnosticCase(pick);
    }

    function resetDiagnosticCase() {
        const cur = D.caseObj;
        if (cur) {
            saveSession(cur === D.caseObj ? D.session : D.session);
        }
        D.active = false;
        D.caseObj = null;
        D.session = null;
        if (typeof window.resetSimulation === 'function') window.resetSimulation();
        if (window.Phase3 && typeof window.Phase3.resetMultimeter === 'function') window.Phase3.resetMultimeter();
        logAction('RESET_CASE', {});
        render();
        return { ok: true };
    }

    /* ============================================================
       ACTIVITY LOG / HINTS / TREE / GUIDED
       ============================================================ */
    function logAction(action, data) {
        const entry = { timestamp: Date.now(), action, data: data || {} };
        sessionSafe().tests.push(entry);
        renderLog();
    }
    function getActivityLog() {
        return (D.session && D.session.tests ? D.session.tests.slice() : []);
    }

    function useHint() {
        if (!D.active || !D.caseObj) return null;
        const k = knowledgeKey();
        const kb = k && KB[k.component] ? KB[k.component][k.faultType] : null;
        const level = Math.min(3, D.hintsUsed + 1);
        D.hintsUsed = level;
        const msg = (kb && kb.hints && kb.hints[level])
            ? kb.hints[level]
            : ['Periksa sumber listrik terlebih dahulu.',
               'Ukur tegangan antara battery positive dan battery negative.',
               'Bandingkan tegangan battery dengan tegangan starter saat cranking.'][level - 1];
        applyPenalty('hints' + level);
        const data = { level, msg };
        sessionSafe().hints = D.hintsUsed;
        logAction('USE_HINT', data);
        render();
        return data;
    }

    function getTreeQuestion() {
        if (!TREE) return null;
        const node = TREE.nodes[D.treeNode];
        return node ? { id: node.id, question: node.question, options: node.options || [], leaf: !!node.leaf } : null;
    }

    function answerTree(optionLabel) {
        if (!TREE) return null;
        const node = TREE.nodes[D.treeNode];
        if (!node || !node.options) return null;
        const opt = node.options.find(o => o.label === optionLabel);
        if (!opt) return null;
        D.treePath.push({ node: node.id, answer: optionLabel });
        D.treeNode = opt.next;
        const feat = LEAF[D.treeNode];
        logAction('PERFORM_TEST', { tree: node.id, answer: optionLabel, result: D.treeNode });
        render();
        return getTreeQuestion();
    }

    function nextGuidedStep() {
        if (!D.caseObj) return null;
        D.guidedStep = Math.min((D.caseObj.guided || []).length, D.guidedStep + 1);
        logAction('PERFORM_TEST', { guided: D.guidedStep });
        render();
        return D.guidedStep;
    }

    /* ============================================================
       MODE + LAB VISIBILITY
       ============================================================ */
    function setMode(mode) {
        mode = String(mode || '').toUpperCase();
        if (['GUIDED', 'STANDARD', 'FREE'].indexOf(mode) < 0) mode = 'GUIDED';
        D.mode = mode;
        if (D.session) D.session.mode = mode;
        logAction('SELECT_MODE', { mode });
        render();
        return D.mode;
    }
    function getMode() { return D.mode; }

    function toggleLab() {
        const lab = $('p4-lab');
        if (!lab) return false;
        lab.classList.toggle('open');
        const btn = $('p4-diag-btn');
        if (btn) btn.classList.toggle('active', lab.classList.contains('open'));
        return lab.classList.contains('open');
    }
    function openLab() { const lab = $('p4-lab'); if (lab) { lab.classList.add('open'); const b = $('p4-diag-btn'); if (b) b.classList.add('active'); } return !!lab; }
    function closeLab() { const lab = $('p4-lab'); if (lab) { lab.classList.remove('open'); const b = $('p4-diag-btn'); if (b) b.classList.remove('active'); } return false; }

    function setDebug(on) { D.debugMode = !!on; render(); return D.debugMode; }
    function getDebug() { return D.debugMode; }

    /* ============================================================
       GETTERS (public API sederhana)
       ============================================================ */
    function getCurrentCase() { return D.caseObj; }
    function getHiddenFault() {
        // Hanya untuk internal engine / debug mode.
        return isDebug() ? (D.caseObj ? D.caseObj.hiddenFault : null) : null;
    }
    function getSymptoms() {
        if (!D.caseObj) return [];
        return [{
            type: D.caseObj.symptom.type,
            description: D.caseObj.symptom.description,
            complaint: D.caseObj.customerComplaint,
            condition: D.caseObj.initialCondition,
        }];
    }
    function getMeasurementHistory() { return measurements(); }
    function getDiagnosticState() {
        return {
            active: D.active,
            mode: D.mode,
            caseId: D.caseObj ? D.caseObj.id : null,
            difficulty: D.caseObj ? D.caseObj.difficulty : null,
            status: D.caseComplete ? (D.verificationPassed ? 'VERIFIED' : 'COMPLETED') : (D.active ? 'IN_PROGRESS' : 'INACTIVE'),
            guidedStep: D.guidedStep,
            treeNode: D.treeNode,
            hypotheses: D.hypotheses.length,
            observations: D.observations.length,
            measurements: measurements().length,
            confidence: D.confidence,
            diagnosisCorrect: D.diagnosisCorrect,
            finalDiagnosis: D.finalDiagnosis,
            repairPerformed: D.repairPerformed,
            repairWasCorrect: D.repairWasCorrect,
            verificationDone: D.verificationDone,
            verificationPassed: D.verificationPassed,
            complete: D.caseComplete,
            penalties: penaltiesTotal,
            hints: D.hintsUsed,
        };
    }

    /* ============================================================
       RENDER (UI)
       ============================================================ */
    function render() {
        renderCaseInfo();
        renderHypotheses();
        renderEvidence();
        renderMeasurements();
        renderConfidence();
        renderGuided();
        renderTree();
        renderDiagnosisBox();
        renderRepair();
        renderScore();
        renderHistory();
        renderDebug();
    }

    function safeText(v) { return v === null || v === undefined ? '' : String(v); }
    function esc(s) {
        return safeText(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function renderCaseInfo() {
        const el = $('p4-caseMeta');
        if (!el) return;
        if (!D.caseObj) {
            $('p4-caseTitle') && ($('p4-caseTitle').textContent = 'Pilih mode lalu START CASE');
            el.innerHTML = 'Pilih mode diagnosis lalu klik START CASE / NEW RANDOM CASE.';
            return;
        }
        const c = D.caseObj;
        $('p4-caseTitle') && ($('p4-caseTitle').textContent = c.id + ' · ' + c.title);
        el.innerHTML = '<div class="p4-row"><strong>Customer Complaint:</strong> ' + esc(c.customerComplaint) + '</div>'
            + '<div class="p4-row"><strong>Kondisi Awal:</strong> ' + esc(c.initialCondition) + '</div>'
            + '<div class="p4-row p4-symptom">Symptom: [' + esc(c.symptom.type) + '] ' + esc(c.symptom.description) + '</div>'
            + '<div class="p4-row p4-difficulty">Difficulty: ' + esc(c.difficulty) + '</div>';
    }

    function componentOptions() {
        let html = '<option value="">— Component —</option>';
        Object.keys(KB).forEach(comp => {
            html += '<option value="' + esc(comp) + '">' + esc(KB[comp][Object.keys(KB[comp])[0]].componentLabel || comp) + '</option>';
        });
        return html;
    }
    function faultOptions(comp) {
        const types = comp && KB[comp];
        let html = '<option value="">— Fault Type —</option>';
        if (types) Object.keys(types).forEach(t => {
            html += '<option value="' + esc(t) + '">' + esc(types[t].faultTypeLabel || t) + '</option>';
        });
        return html;
    }

    function renderHypotheses() {
        const selComp = $('p4-hypComp');
        const selFault = $('p4-hypFault');
        if (selComp && !selComp.dataset.built) {
            selComp.innerHTML = componentOptions();
            selComp.dataset.built = '1';
            if (D.caseObj) {
                selComp.value = D.caseObj.hiddenFault && isDebug() ? D.caseObj.hiddenFault.component : '';
            }
        }
        if (selFault) {
            const comp = selComp ? selComp.value : '';
            const wanted = (D.caseObj && isDebug()) ? D.caseObj.hiddenFault.faultType : '';
            selFault.innerHTML = faultOptions(comp);
            if (comp) selFault.value = wanted;
        }
        const list = $('p4-hypList');
        if (!list) return;
        if (!D.active) { list.innerHTML = '<div class="p4-muted">Belum ada sesi.</div>'; return; }
        if (!D.hypotheses.length) { list.innerHTML = '<div class="p4-muted">Buat hipotesis setelah melakukan inspeksi & pengukuran.</div>'; return; }
        list.innerHTML = D.hypotheses.map(h => {
            const e = h.evaluation || {};
            const cls = e.verdict === 'SUPPORTED' ? 'p4-ev-ok' : e.verdict === 'NOT_SUPPORTED' ? 'p4-ev-bad' : 'p4-ev-warn';
            return '<div class="p4-hyp-item"><strong>' + esc(h.id) + '</strong> '
                + esc(h.component + ' : ' + h.faultType)
                + '<div class="p4-hyp-reason">' + esc(h.reason || '—') + '</div>'
                + '<div class="' + cls + '">' + esc(verdictLabel(e.verdict)) + ' · conf: ' + esc(e.confidence || 'LOW') + ' (' + (e.matched || 0) + '/' + (e.total || 0) + ')</div></div>';
        }).join('');
    }

    function verdictLabel(v) {
        return { SUPPORTED: 'SUPPORTING EVIDENCE', NOT_SUPPORTED: 'NOT SUPPORTED', INSUFFICIENT: 'INSUFFICIENT', INVALID: 'INVALID' }[v] || v || '';
    }

    function renderEvidence() {
        const el = $('p4-evidenceBody');
        if (!el) return;
        const ev = evidenceSummary();
        if (!D.active || !D.caseObj) { el.innerHTML = '<div class="p4-muted">—</div>'; return; }
        el.innerHTML = ev.map(e => {
            const icon = e.matched ? '✓' : e.measured ? '✕' : '?';
            const cls = e.matched ? 'p4-ev-ok' : e.measured ? 'p4-ev-bad' : 'p4-ev-warn';
            return '<div class="p4-ev-item ' + cls + '"><b>' + icon + '</b> ' + esc(e.mode + ' ' + e.pair) + (e.during !== '*' ? ' (' + esc(e.during) + ')' : '')
                + '<div class="p4-ev-note">' + esc(e.note || '') + '</div></div>';
        }).join('');
    }

    function renderMeasurements() {
        const el = $('p4-measBody');
        if (!el) return;
        const recs = measurements();
        el.innerHTML = recs.length
            ? recs.slice(-8).reverse().map(r => '<div class="p4-meas-item">' + esc(r.test || r.mode || '') + ' · ' + esc(r.redProbe + '→' + r.blackProbe) + ' = <b>' + esc(r.raw || (r.value !== null ? r.value + (r.unit ? ' ' + r.unit : '') : 'OL')) + '</b> [' + esc(r.systemState || '') + ']</div>').join('')
            : '<div class="p4-muted">Gunakan MULTIMETER (Phase 3) untuk mengukur. Pengukuran tampil di sini.</div>';
    }

    function renderConfidence() {
        const lab = $('p4-confLabel');
        const bar = $('p4-confBar');
        if (!lab || !bar) return;
        const calc = calculateDiagnosticConfidence();
        let level = calc.level;
        if (D.diagnosisCorrect && D.repairWasCorrect && D.verificationPassed) level = 'CONFIRMED';
        lab.textContent = level;
        const pct = { LOW: 25, MEDIUM: 55, HIGH: 80, CONFIRMED: 100 }[level] || 0;
        bar.style.width = pct + '%';
        bar.className = 'p4-conf-bar ' + ('p4-conf-' + level.toLowerCase());
    }

    function renderGuided() {
        const el = $('p4-guidedList');
        if (!el) return;
        if (D.mode !== 'GUIDED') { el.innerHTML = '<div class="p4-muted">Mode ' + D.mode + ' — tidak ada langkah terbimbing.</div>'; return; }
        if (!D.caseObj) { el.innerHTML = '<div class="p4-muted">Mulai kasus untuk melihat langkah.</div>'; return; }
        const steps = D.caseObj.guided || [];
        el.innerHTML = steps.map((s, i) => {
            const done = i < D.guidedStep;
            const cur = i === D.guidedStep;
            return '<div class="p4-gstep' + (done ? ' done' : '') + (cur ? ' cur' : '') + '">' + (done ? '✓ ' : (i + 1) + '. ') + esc(s) + '</div>';
        }).join('');
    }

    function renderTree() {
        const q = $('p4-treeQ');
        const opts = $('p4-treeOpts');
        if (!q || !opts) return;
        if (D.mode === 'FREE') { q.textContent = ''; opts.innerHTML = '<div class="p4-muted">FREE MODE — bebas memeriksa.</div>'; return; }
        const node = getTreeQuestion();
        if (!node) { q.textContent = ''; opts.innerHTML = ''; return; }
        q.textContent = (D.mode === 'GUIDED' ? '(Auto) ' : 'Tree: ') + node.question;
        const pin = D.mode === 'GUIDED';
        opts.innerHTML = (node.options || []).map((o, i) => {
            const auto = pin && D.guidedStep >= 6 ? 'onclick="window.Phase4&&window.Phase4.answerTree(\'' + esc(o.label) + '\')"' : '';
            return '<button class="btn-sm" type="button" ' + auto + (o.hint ? ' title="' + esc(o.hint) + '"' : '') + '>' + esc(o.label) + '</button>';
        }).join('') || '';
    }

    function renderDiagnosisBox() {
        const div = $('p4-diagOut');
        if (!div) return;
        if (!D.active) { div.textContent = '—'; return; }
        let m = 'Diagnosis: ' + (D.finalDiagnosis ? esc(D.finalDiagnosis.label) : 'belum dikirim.');
        if (D.verificationPassed) m += ' — VERIFIED ✓';
        else if (D.caseComplete) m += ' — selesai tanpa verifikasi.';
        div.textContent = m;
    }

    function renderRepair() {
        const list = $('p4-repairList');
        const detail = $('p4-repairDetail');
        if (!list) return;
        if (!D.diagnosisCorrect) {
            list.innerHTML = '<div class="p4-muted">Lengkapi diagnosis sebelum melakukan repair.</div>';
            if (detail) detail.innerHTML = '';
            return;
        }
        const kb = activeKB();
        const correctId = kb ? kb.repairId : '';
        list.innerHTML = REPAIRS.map(r => {
            const isCorrect = r.id === correctId;
            return '<div class="p4-repair-item">'
                + '<button class="btn-sm" type="button" onclick="window.Phase4&&window.Phase4.applyRepair(\'' + esc(r.id) + '\')">' + esc(r.label) + '</button>'
                + (isCorrect ? ' <span class="p4-ev-ok">(tepat untuk kasus ini)</span>' : '')
                + (D.repairPerformed === r.id ? ' <span class="' + (D.repairWasCorrect ? 'p4-ev-ok' : 'p4-ev-bad') + '">terpasang</span>' : '')
                + '</div>';
        }).join('');
        if (detail) {
            const rep = REPAIRS.find(r => r.id === D.repairPerformed);
            detail.innerHTML = rep
                ? '<strong>Prosedur: ' + esc(rep.label) + '</strong><ol>' + rep.procedures.map(p => '<li>' + esc(p) + '</li>').join('') + '</ol>'
                : '';
        }
    }

    function renderScore() {
        const el = $('p4-scoreBody');
        if (!el) return;
        if (!D.caseComplete || !D.score) { el.textContent = 'Skor dihitung setelah kasus selesai.'; return; }
        const s = D.score;
        el.innerHTML = '<div class="p4-score-total">Skor Akhir: <b>' + s.total + '/100</b></div>'
            + '<table class="p4-score-table"><tbody>'
            + Object.keys(SCORE).map(k => '<tr><td>' + esc(k) + '</td><td>' + Math.round(s.components[k] || 0) + '/' + SCORE[k] + '</td></tr>').join('')
            + '</tbody></table>'
            + '<div class="p4-muted">Penalti: ' + s.penalties.total + '</div>';
    }

    function renderHistory() {
        const el = $('p4-historyBody');
        if (!el) return;
        const list = getSavedSessions();
        el.innerHTML = list.length
            ? '<table class="p4-hist-table"><thead><tr>'
            + '<th>Case</th><th>Date</th><th>Diff</th><th>Diagnosis</th><th>Score</th><th>Time</th><th>Status</th>'
            + '</tr></thead><tbody>'
            + list.map(s => '<tr>'
                + '<td>' + esc(s.caseId) + '</td>'
                + '<td>' + esc(new Date(s.startTime).toLocaleString()) + '</td>'
                + '<td>' + esc(s.difficulty || '') + '</td>'
                + '<td>' + esc((s.finalDiagnosis && s.finalDiagnosis.label) || '—') + '</td>'
                + '<td>' + (s.score || 0) + '</td>'
                + '<td>' + Math.round(((s.endTime || s.startTime) - s.startTime) / 1000) + 's</td>'
                + '<td>' + esc(s.status || '') + '</td></tr>').join('')
            + '</tbody></table>'
            : '<div class="p4-muted">Belum ada riwayat. Selesaikan sebuah kasus.</div>';
    }

    function renderDebug() {
        const el = $('p4-debugBody');
        if (!el) return;
        if (!isDebug()) { el.innerHTML = ''; return; }
        el.innerHTML = '<div class="p4-debug-hint">DEBUG MODE ON</div>'
            + '<div>Hidden Fault: ' + esc(JSON.stringify(D.caseObj ? D.caseObj.hiddenFault : null)) + '</div>'
            + '<div>Params: ' + esc(JSON.stringify((activeKB() && activeKB().params) || null)) + '</div>'
            + '<div>State: ' + esc(JSON.stringify(getDiagnosticState())) + '</div>'
            + '<div>Sim: relay=' + esc(Sim.relayState) + ' solenoid=' + esc(Sim.solenoidState)
            + ' starter=' + esc(Sim.starterState) + ' engine=' + esc(Sim.engineState) + '</div>'
            + '<div>Sim hooks: terminalResistance=' + Sim.terminalResistance
            + ' cableMult=' + Sim.cableResistanceMult
            + ' relayFaultType=' + esc(Sim.relayFaultType)
            + ' solenoidMainFail=' + Sim.solenoidMainFail
            + ' pinionFail=' + Sim.pinionFail + '</div>';
    }

    function renderLog() {
        const el = $('p4-logBody');
        if (!el) return;
        const log = getActivityLog();
        el.innerHTML = log.slice(-20).reverse().map(l =>
            '<div class="p4-log-item">' + esc(l.action + (l.data && Object.keys(l.data).length ? ' ' + JSON.stringify(l.data) : '')) + '</div>'
        ).join('') || '<div class="p4-muted">Log kosong.</div>';
    }

    /* ============================================================
       WORKBOOK (worksheet) helpers + report view
       ============================================================ */
    function fillWorkbook() {
        const rep = generateDiagnosticReport();
        ['complaint', 'symptom', 'inspection', 'hypothesis', 'measurement', 'evidence', 'conclusion', 'repair', 'verification'].forEach(field => {
            const el = $('p4ws-' + field);
            if (!el) return;
            const v = field === 'complaint' ? rep.customerComplaint
                : field === 'symptom' ? rep.symptom
                    : field === 'inspection' ? (getDiagnosticState().observations + ' observasi sistem')
                        : field === 'hypothesis' ? (D.finalDiagnosis ? D.finalDiagnosis.label : '')
                            : field === 'measurement' ? rep.measurements.slice(-3).map(m => m.red + '→' + m.black + ' = ' + m.value + (m.ol ? ' (OL)' : '')).join('; ')
                                : field === 'evidence' ? (D.hypotheses[0] ? D.hypotheses[0].evaluation.verdict : '')
                                    : field === 'conclusion' ? (D.finalDiagnosis ? D.finalDiagnosis.label : '')
                                        : field === 'repair' ? (rep.repair || '')
                                            : field === 'verification' ? rep.verification : '';
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = v; else el.textContent = v;
        });
        renderReport();
    }
    function clearWorkbook() {
        ['complaint', 'symptom', 'inspection', 'hypothesis', 'measurement', 'evidence', 'conclusion', 'repair', 'verification'].forEach(field => {
            const el = $('p4ws-' + field);
            if (!el) return;
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') el.value = ''; else el.textContent = '';
        });
    }
    function renderReport() {
        const el = $('p4-report');
        if (!el) return;
        const rep = generateDiagnosticReport();
        el.innerHTML = '<h3>DIAGNOSTIC REPORT</h3>'
            + '<p><b>Case:</b> ' + esc(rep.caseId) + ' — ' + esc(rep.title) + ' (' + esc(rep.difficulty) + ')</p>'
            + '<p><b>Customer Complaint:</b> ' + esc(rep.customerComplaint) + '</p>'
            + '<p><b>Initial Symptom:</b> ' + esc(rep.symptom) + '</p>'
            + '<p><b>Measurements:</b> ' + (rep.measurements.length ? rep.measurements.map(m => esc(m.red + '→' + m.black + ' = ' + m.value + (m.ol ? ' OL' : ' ' + m.unit))).join('; ') : '—') + '</p>'
            + '<p><b>Diagnosis:</b> ' + esc(rep.diagnosis) + '</p>'
            + '<p><b>Root Cause:</b> ' + esc(rep.rootCause) + '</p>'
            + '<p><b>Repair:</b> ' + esc(rep.repair) + '</p>'
            + '<p><b>Verification:</b> ' + esc(rep.verification) + '</p>'
            + '<p><b>Diagnosis Status:</b> ' + esc(rep.status) + '</p>'
            + '<p><b>Score:</b> ' + rep.score + ' · <b>Confidence:</b> ' + esc(rep.confidence) + '</p>';
    }

    /* ============================================================
       EVENT WIRE + INIT
       ============================================================ */
    function init() {
        if (EventBus && typeof EventBus.on === 'function') {
            EventBus.on('starterStarted', () => {
                if (D.active && D.caseObj && Sim.starterState === 'CRANKING') {
                    observeSystem('STARTER_CRANKING');
                }
            });
        }
        // Undang toolbar button.
        const btn = $('p4-diag-btn');
        if (btn) { const lbl = btn.querySelector && btn.querySelector('span'); if (lbl) lbl.textContent = 'DIAG'; else btn.innerHTML = 'DIAG'; }
        render();
    }

    window.Phase4 = {
        active: true,
        getConfig: () => CFG,
        setDebug: setDebug,
        getDebug: getDebug,

        // Case
        startDiagnosticCase: startDiagnosticCase,
        startRandomCase: startRandomCase,
        getCurrentCase: getCurrentCase,
        getHiddenFault: getHiddenFault,
        getSymptoms: getSymptoms,
        resetDiagnosticCase: resetDiagnosticCase,
        getDiagnosticState: getDiagnosticState,

        // Mode
        setMode: setMode,
        getMode: getMode,

        // Hypothesis & evidence
        createHypothesis: createHypothesis,
        evaluateHypothesis: evaluateHypothesis,
        getEvidence: getEvidence,
        getMeasurementHistory: getMeasurementHistory,
        calculateDiagnosticConfidence: calculateDiagnosticConfidence,
        submitDiagnosis: submitDiagnosis,

        // Repair & verification
        applyRepair: applyRepair,
        verifyRepair: verifyRepair,
        generateDiagnosticReport: generateDiagnosticReport,
        getDiagnosticScore: getDiagnosticScore,

        // Activity / session / history / hints
        getActivityLog: getActivityLog,
        observeSystem: observeSystem,
        useHint: useHint,
        getSavedSessions: getSavedSessions,

        // Tree / guided
        getTreeQuestion: getTreeQuestion,
        answerTree: answerTree,
        nextGuidedStep: nextGuidedStep,

        // Worksheet & report
        fillWorkbook: fillWorkbook,
        clearWorkbook: clearWorkbook,
        renderReport: renderReport,

        // Lab visibility
        toggleLab: toggleLab,
        openLab: openLab,
        closeLab: closeLab,

        // test helpers
        evaluateHypothesisByKey: evaluateHypothesisByKey,
    };

    if (document && document.addEventListener) {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();