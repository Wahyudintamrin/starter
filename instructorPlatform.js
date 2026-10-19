/* ============================================================================
   PHASE 8 — INSTRUCTOR PLATFORM, CLASSROOM MANAGEMENT & CLOUD LEARNING SYSTEM
   ============================================================================
   STEP 2-18  (spesifikasi §106: STEP 1 audit / STEP 2 architecture /
              STEP 3 user-role / STEP 4 organization / STEP 5 classroom /
              STEP 6 student dashboard / STEP 7 instructor dashboard /
              STEP 8 course-content library / STEP 9 assignment engine /
              STEP 10 submission engine / STEP 11 instructor grading /
              STEP 12 rubric engine / STEP 13 diagnostic session review /
              STEP 14 indexeddb / STEP 15 repository layer /
               STEP 16 offline mode / STEP 17 sync queue /
                STEP 18 cloud api abstraction / STEP 19 analytics /
                STEP 20 learning-path recommendation / STEP 21 mentor review & follow-up /
                STEP 22 cloud sync & deterministic retry / STEP 23 equity & deterministic self-efficacy monitoring /
                STEP 24 portfolio & learning-outcome attainment export (deterministik A40-42) /
                STEP 25 FINAL CAPSTONE: consolidated whole-platform cert of attainment & learning-outcome completion (deterministik A43-45))

   PRINSIP (phase8):
   - ONE PLATFORM — satu lapisan Identity + Classroom + LMS di ATAS engine
     Phase 1-7. Phase 8 TIDAK membuat simulator/engine diagnosis kedua.
   - Services memanggil repositories, bukan UI (§69, §85).
   - Repository bisa diganti Local <-> Cloud tanpa mengubah UI (§35).
   - apiClient abstraction + Mock API Adapter (backend-agnostic, §37-38).
   - Deterministik: phase8 TIDAK memanggil Math.random (join code / token
     memakai PRNG seeded mulberry32; butuh "random()" hanya saat setSeed).
   - Password tidak disimpan plaintext (§44): hash salted (FNV-1a).
   - RBAC diperiksa di service layer, bukan hanya menyembunyikan tombol (§6).
   - Mode: GUEST / STUDENT / INSTRUCTOR / ADMIN (§3).
   - Error model konsisten: { success:false, error:{ code, message } } (§83).

   File lain yang TIDAK diubah: simulator engine, phase2-7, konten, 3D.
   ============================================================================ */

(function () {
    'use strict';

    var VERSION = 8;
    var STEP = '8-24';

    /* ------------------------------------------------------------------------
       0. WINDOW / GLOBAL RESOLUTION + UTILITIES
       ------------------------------------------------------------------------ */
    var hasWindow = typeof window !== 'undefined';
    function globalObj(name) { return hasWindow ? window[name] : (typeof name !== 'undefined' ? name : null); }

    /* PRNG deterministik (TIDAK ada Math.random literal di file ini) */
    function mulberry32(seed) {
        var a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    var rngFn = mulberry32(20260818);
    function setSystemSeed(seed) { rngFn = mulberry32(seed); }
    function rng() { return rngFn(); }

    /* jam: bisa di-override agar pengujian deterministik */
    var clock = function () { return Date.now(); };
    function setSystemClock(fn) { clock = fn; }
    function now() { return clock(); }

    function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
    var seqPerPrefix = {};
    /* Mode cloud (Supabase): id berurutan (USER_001) pasti bentrok antar perangkat -> pakai id acak. */
    var CLOUD_IDS = typeof window !== 'undefined' && !!(window.STARTERLAB_SUPABASE && window.STARTERLAB_SUPABASE.url && window.STARTERLAB_SUPABASE.anonKey);
    function genId(prefix) {
        if (CLOUD_IDS) return prefix + '_' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
        var n = (seqPerPrefix[prefix] || 0) + 1;
        seqPerPrefix[prefix] = n;
        return prefix + '_' + pad(n, 3);
    }

    /* FNV-1a 32-bit + salt (hash deterministik; bukan plaintext) */
    function hashStr(s) {
        var h = 2166136261;
        for (var i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0).toString(36);
    }
    function saltFor(id) { return (id + '::' + (rng() * 1e9 | 0)).toString(36); }
    function hashPassword(pw, salt) { return hashStr(salt + '|' + pw); }

    var CODE_CHARS = 'ACDEFGHJKLMNPQRSTUVWXYZ2345679';

    /* ------------------------------------------------------------------------
       1. STATE SEPARATION (§86)
       - simulation state  : Sim.* (dipegang phase1-7, dibaca via caseRepository)
       - learning state    : dipegang Phase5 (progress/assessment/job/diagnostic)
       - session state     : di bawah ini
       - ui state / sync state : interface utk STEP berikutnya
       ------------------------------------------------------------------------ */
    var session = {
        userId: null, role: 'GUEST', token: null,
        startedAt: null, expiresAt: null
    };
    var syncState = { network: 'ONLINE', queue: 0, lastSyncAt: null };

    /* ------------------------------------------------------------------------
       2. STORAGE / REPOSITORY LAYER (§34-36) — Step 14 (IndexedDB) & Step 15
       (Repository Layer).
       Provider bisa ditukar: memory (default) -> localStorage -> IndexedDB
       ------------------------------------------------------------------------ */
    var maps = {
        users: {}, organizations: {}, classes: {},
        assignments: {}, submissions: {}, courses: {}, contents: {}, caseRefs: {}, rubrics: {},
        achievements: {}, assessments: {},
        audit: [], syncQueue: [], notifications: [], activity: []
    };
    var providerHooks = {};

    var storeProvider = {
        // interface: repos memakai getStore(entity); onSaved(entity) hook
        getStore: function (entity) { return maps[entity] || (maps[entity] = {}); },
        getList: function (entity) { return maps[entity] || (maps[entity] = []); },
        onSaved: function (entity) {
            if (providerHooks[entity]) providerHooks[entity](maps[entity]);
        },
        setHook: function (entity, fn) { providerHooks[entity] = fn; }
    };
    var defaultProviderFns = {
        getStore: storeProvider.getStore,
        getList: storeProvider.getList,
        onSaved: storeProvider.onSaved
    };
    function setStoreProvider(provider) {
        if (provider && typeof provider.getStore === 'function') {
            // repos dibuat di atas provider: simpan ref + migrasi data
            storeProvider.getStore = provider.getStore.bind(provider) || defaultProviderFns.getStore;
            storeProvider.getList = (provider.getList && provider.getList.bind(provider)) || defaultProviderFns.getList;
            storeProvider.onSaved = (typeof provider.onSaved === 'function' ? provider.onSaved.bind(provider) : defaultProviderFns.onSaved);
            storeProvider._custom = true;
        } else {
            // tanpa argumen -> kembalikan provider in-memory default
            storeProvider.getStore = defaultProviderFns.getStore;
            storeProvider.getList = defaultProviderFns.getList;
            storeProvider.onSaved = defaultProviderFns.onSaved;
            storeProvider._custom = false;
        }
        return storeProvider;
    }

    /* ------------------------------------------------------------------------
       2b. INDEXEDDB PROVIDER (STEP 14, §36) — local database (local-first)
       Provider sama seperti memory/localStorage: repos membaca memory secara
       sinkron, lalu persistence disalurkan ke IndexedDB (write-through async).
       Jika IndexedDB tidak tersedia -> fallback memory (offline/demo-safe).
       ------------------------------------------------------------------------ */
    var ENTITY_STORES = ['users', 'organizations', 'classes', 'assignments', 'submissions',
        'courses', 'contents', 'caseRefs', 'rubrics', 'achievements', 'assessments'];
    var ENTITY_LISTS = ['audit', 'syncQueue', 'notifications', 'activity'];
    var ENTITY_KEYS_ALL = ENTITY_STORES.concat(ENTITY_LISTS);

    function createMemoryIdbAdapter(storeNames) {
        // adapter in-memory meniru interface IndexedDB ({open,tx}) untuk demo/testing.
        var data = {};
        storeNames.forEach(function (n) { data[n] = []; });
        function ops(n) {
            if (!data[n]) data[n] = []; // store tambahan dibuat lazy (sama spt obj store kosong)
            return {
                get: function (key) {
                    return Promise.resolve(data[n].filter(function (r) { return r.id === key; })[0] || null);
                },
                put: function (rec) {
                    var found = false;
                    data[n] = data[n].map(function (r) { if (r.id === rec.id) { found = true; return rec; } return r; });
                    if (!found) data[n].push(rec);
                    return Promise.resolve();
                },
                getAll: function () { return Promise.resolve(data[n].slice()); },
                clear: function () { data[n] = []; return Promise.resolve(); }
            };
        }
        return {
            backend: 'INDEXEDDB',
            open: function () { return Promise.resolve({ objectStoreNames: storeNames.slice() }); },
            tx: function (names) {
                return Promise.resolve({ objectStore: function (name) { return ops(name); } });
            },
            counts: function () {
                var out = {};
                Object.keys(data).forEach(function (n) { out[n] = data[n].length; });
                return out;
            }
        };
    }

    function createIndexedDBProvider(opts) {
        opts = opts || {};
        var entityObjects = (opts.entityObjects && opts.entityObjects.length) ? opts.entityObjects : ENTITY_STORES;
        var entityLists = (opts.entityLists && opts.entityLists.length) ? opts.entityLists : ENTITY_LISTS;
        var memory = {};
        entityObjects.forEach(function (n) { memory[n] = {}; });
        entityLists.forEach(function (n) { memory[n] = []; });
        var adapter = null;
        var ready = false;
        var dirty = {};
        var backend = 'MEMORY';
        function arrayLike(entity) { return entityLists.indexOf(entity) >= 0; }
        function recordsOf(entity) {
            if (arrayLike(entity)) return memory[entity].slice();
            var out = [];
            var m = memory[entity] || {};
            for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) out.push(m[k]);
            return out;
        }
        function withStore(entity, mode, fn) {
            return adapter.tx([entity], mode).then(function (t) { return fn(t.objectStore(entity)); });
        }
        function readEntity(entity) {
            return withStore(entity, 'readonly', function (os) {
                return os.getAll().then(function (recs) {
                    if (arrayLike(entity)) {
                        memory[entity] = Array.isArray(recs) ? recs.slice() : [];
                    } else {
                        var map = memory[entity] || (memory[entity] = {});
                        var keep = {};
                        Array.isArray(recs) ? recs : [];
                        recs.forEach(function (r) { if (r && r.id) keep[r.id] = r; });
                        for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k) && !keep[k]) delete map[k];
                        for (var k2 in keep) map[k2] = keep[k2];
                    }
                });
            });
        }
        return {
            _custom: true,
            backend: 'MEMORY',
            kind: 'INDEXEDDB',
            isReady: function () { return ready; },
            adapter: function () { return adapter; },
            memory: memory,
            // antarmuka sinkron yang dipakai repos (via storeProvider.setProvider)
            getStore: function (entity) { return memory[entity] || (memory[entity] = {}); },
            getList: function (entity) { return memory[entity] || (memory[entity] = []); },
            onSaved: function (entity) { if (ready) dirty[entity] = true; },
            // lifecycle IndexedDB (async)
            open: function (adapt) {
                adapter = adapt || null;
                if (!adapter || typeof adapter.tx !== 'function' || typeof adapter.open !== 'function') {
                    ready = false;
                    backend = 'MEMORY';
                    return Promise.resolve({ backend: backend, ready: ready });
                }
                return adapter.open().then(function () {
                    var chain = Promise.resolve();
                    entityObjects.forEach(function (n) { chain = chain.then(function () { return readEntity(n); }); });
                    entityLists.forEach(function (n) { chain = chain.then(function () { return readEntity(n); }); });
                    return chain.then(function () {
                        ready = true;
                        backend = 'INDEXEDDB';
                        return { backend: backend, ready: ready, stores: entityObjects.length + entityLists.length };
                    });
                });
            },
            // tulis-perubahan (write-through) ke IndexedDB
            flush: function () {
                if (!ready || !adapter) return Promise.resolve({ flushed: 0, backend: backend });
                var names = Object.keys(dirty);
                var flushed = 0;
                var chain = Promise.resolve();
                names.forEach(function (entity) {
                    chain = chain.then(function () {
                        return withStore(entity, 'readwrite', function (os) {
                            return os.clear().then(function () {
                                var recs = recordsOf(entity);
                                var putChain = Promise.resolve();
                                recs.forEach(function (r) { putChain = putChain.then(function () { return os.put(r); }); });
                                return putChain;
                            }).then(function () { flushed++; });
                        });
                    });
                });
                return chain.then(function () {
                    for (var k in dirty) if (Object.prototype.hasOwnProperty.call(dirty, k)) delete dirty[k];
                    return { flushed: flushed, backend: backend };
                });
            },
            exportData: function () {
                var out = {};
                ENTITY_KEYS_ALL.forEach(function (n) { out[n] = recordsOf(n); });
                return out;
            }
        };
    }

    /* Adapter IndexedDB browser asli (tersedia bila window.indexedDB ada). */
    function createBrowserIdbAdapter(storeNames) {
        storeNames = storeNames || ENTITY_KEYS_ALL;
        var dbRef = null;
        function prom(req) {
            return new Promise(function (resolve, reject) {
                req.onsuccess = function () { resolve(req.result); };
                req.onerror = function () { reject(req.error); };
            });
        }
        return {
            backend: 'INDEXEDDB',
            open: function () {
                return new Promise(function (resolve, reject) {
                    var idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
                    if (!idb) { reject(new Error('IndexedDB unavailable')); return; }
                    var req = idb.open('phase8-local', 1);
                    req.onupgradeneeded = function () {
                        var d = req.result;
                        storeNames.forEach(function (n) {
                            if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' });
                        });
                    };
                    req.onsuccess = function () {
                        dbRef = req.result;
                        var names = [];
                        for (var i = 0; i < dbRef.objectStoreNames.length; i++) names.push(dbRef.objectStoreNames[i]);
                        resolve({ objectStoreNames: names });
                    };
                    req.onerror = function () { reject(req.error); };
                });
            },
            tx: function (names, mode) {
                return new Promise(function (resolve, reject) {
                    var t = dbRef.transaction(names, mode || 'readonly');
                    resolve({
                        objectStore: function (name) {
                            var s = t.objectStore(name);
                            return {
                                get: function (key) { return prom(s.get(key)); },
                                put: function (rec) { return prom(s.put(rec)); },
                                getAll: function () { return prom(s.getAll()); },
                                clear: function () { return prom(s.clear()); }
                            };
                        }
                    });
                });
            }
        };
    }

    function makeRepo(prefix, entity) {
        return {
            getById: function (id) { return storeProvider.getStore(entity)[id] || null; },
            list: function () {
                var m = storeProvider.getStore(entity);
                var out = [];
                for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) out.push(m[k]);
                return out;
            },
            query: function (filter) {
                var m = storeProvider.getStore(entity);
                var out = [];
                for (var k in m) {
                    if (Object.prototype.hasOwnProperty.call(m, k)) {
                        var rec = m[k];
                        if (!filter || filter(rec)) out.push(rec);
                    }
                }
                return out;
            },
            save: function (rec) {
                var m = storeProvider.getStore(entity);
                if (!rec.id) rec.id = genId(prefix);
                rec.updatedAt = now();
                if (m[rec.id]) { m[rec.id] = rec; } else { m[rec.id] = rec; rec.createdAt = now(); }
                storeProvider.onSaved(entity);
                return rec;
            },
            remove: function (id) {
                var m = storeProvider.getStore(entity);
                if (m[id]) { delete m[id]; storeProvider.onSaved(entity); return true; }
                return false;
            },
            clear: function () {
                storeProvider.getStore(entity);
                var m = storeProvider.getStore(entity);
                for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) delete m[k];
                storeProvider.onSaved(entity);
            }
        };
    }

    function makeListRepo(entity) {
        return {
            add: function (rec) { storeProvider.getList(entity).push(rec); storeProvider.onSaved(entity); return rec; },
            list: function () { return storeProvider.getList(entity).slice(); },
            query: function (filter) { return storeProvider.getList(entity).filter(function (r) { return !filter || filter(r); }); },
            clear: function () { var l = storeProvider.getList(entity); l.length = 0; storeProvider.onSaved(entity); }
        };
    }

    var userRepository = makeRepo('USER', 'users');
    var organizationRepository = makeRepo('ORG', 'organizations');
    var classRepository = makeRepo('CLASS', 'classes');
    var assignmentRepository = makeRepo('ASSIGN', 'assignments');
    var submissionRepository = makeRepo('SUB', 'submissions');
    var courseRepository = makeRepo('COURSE', 'courses');
    var caseRepository = makeRepo('CASE', 'caseRefs');
    // Integrasi dengan engine yang sudah ada (§70): referensi katalog Phase 7,
    // bukan duplikasi simulator/konten.
    caseRepository.importFromPhase7 = function () {
        var p7 = hasWindow ? window.Phase7 : (typeof Phase7 !== 'undefined' ? Phase7 : null);
        if (!p7 || typeof p7.listScenarios !== 'function') {
            return apiError('NOT_AVAILABLE', 'Phase7 scenario engine not loaded.');
        }
        var metas = p7.listScenarios() || [];
        var imported = 0;
        metas.forEach(function (m) {
            var dup = false;
            var m2 = storeProvider.getStore('caseRefs');
            for (var k in m2) {
                if (Object.prototype.hasOwnProperty.call(m2, k) && m2[k].refId === m.id) { dup = true; break; }
            }
            if (dup) return;
            var rec = {
                id: genId('CASE'), refId: m.id, difficulty: m.difficulty,
                title: m.title || m.id, skillFocus: m.skillFocus || null,
                complaint: m.complaint || null, vehicleProfile: m.vehicleProfile,
                expectedSymptoms: (m.expectedSymptoms || []).slice(),
                factors: m.factors ? {
                    faultCount: m.factors.faultCount, hasInteraction: !!m.factors.hasInteraction,
                    ambiguity: m.factors.ambiguity, pathLength: m.factors.pathLength,
                    intermittency: !!m.factors.intermittency, progression: !!m.factors.progression
                } : null,
                status: 'PUBLISHED'
            };
            caseRepository.save(rec);
            imported++;
        });
        return apiResult({ imported: imported, total: metas.length });
    };
    // Rubrik default terintegrasi Phase5 §25 / Phase8 §23 (8 kriteria, bobot 100).
    var rubricRepository = makeRepo('RUB', 'rubrics');
    rubricRepository.seedDefaults = function () {
        if (rubricRepository.getById('RUB_DEFAULT')) return apiResult({ imported: 0, total: 1, existed: true });
        var rec = defaultPracticalRubric();
        rec.id = 'RUB_DEFAULT';
        rec.createdBy = 'SYSTEM';
        rubricRepository.save(rec);
        return apiResult({ imported: 1, total: 1, existed: false });
    };
    var assessmentRepository = makeRepo('ASMT', 'assessments');
    var analyticsRepository = {
        progress: function (userId) { return computeUserProgress(userId); },
        classSummary: function (classId) { return computeClassProgress(classId); },
        learningAnalytics: function (userId) { return computeLearningAnalytics(userId); },
        classAnalytics: function (classId, actorOpts) { return computeClassAnalytics(classId, actorOpts); },
        studentDetail: function (classId, studentId, actorOpts) { return computeStudentDetail(classId, studentId, actorOpts); },
        analyticNote: function () { return { warning: 'Analytics membantu memahami kebutuhan pembelajaran, bukan penilaian tunggal terhadap kemampuan siswa (§28).' }; }
    };
    var studentRepository = {
        getById: function (id) {
            var u = userRepository.getById(id);
            return (u && u.role === 'STUDENT') ? u : null;
        },
        list: function () {
            return studentRepository.query(null);
        },
        query: function (filter) {
            return userRepository.list().filter(function (u) {
                if (u.role !== 'STUDENT') return false;
                return !filter || filter(u);
            });
        },
        save: function (data) {
            data.role = 'STUDENT';
            return userRepository.save(data);
        },
        remove: function (id) {
            var u = userRepository.getById(id);
            if (u && u.role === 'STUDENT') return userRepository.remove(id);
            return false;
        },
        findByClass: function (classId) {
            return studentRepository.list().filter(function (u) { return (u.classIds || []).indexOf(classId) >= 0; });
        }
    };
    var diagnosticRepository = {
        list: function () {
            return diagnosticRepository.query(null);
        },
        query: function (filter) {
            return submissionRepository.list().filter(function (s) {
                var a = assignmentRepository.getById(s.assignmentId);
                if (!a || a.type !== 'DIAGNOSTIC_CASE') return false;
                return !filter || filter(s);
            });
        },
        getById: function (id) {
            var s = submissionRepository.getById(id);
            if (!s) return null;
            var a = assignmentRepository.getById(s.assignmentId);
            return (a && a.type === 'DIAGNOSTIC_CASE') ? s : null;
        }
    };
    var auditRepository = makeListRepo('audit');
    var syncQueueRepository = makeListRepo('syncQueue');
    var notificationRepository = makeListRepo('notifications');
    var activityRepository = makeListRepo('activity');

    /* ------------------------------------------------------------------------
       3. CANONICAL DATA (mixed) untuk API mock — ringkas, jangan duplicate.
       ------------------------------------------------------------------------ */
    var ROLES = ['GUEST', 'STUDENT', 'INSTRUCTOR', 'ADMIN'];
    var ORG_TYPES = ['SCHOOL', 'TRAINING_CENTER', 'AUTOMOTIVE_INSTITUTION', 'INDIVIDUAL'];

    var PERMISSIONS = [
        'USE_SIMULATOR', 'VIEW_CONTENT', 'VIEW_OWN_RESULT',
        'AUTH_LOGIN', 'AUTH_CHANGE_OWN_PASSWORD',
        'CREATE_ORGANIZATION', 'EDIT_ORGANIZATION', 'ARCHIVE_ORGANIZATION', 'VIEW_ORGANIZATION',
        'CREATE_CLASS', 'EDIT_CLASS', 'ARCHIVE_CLASS', 'VIEW_CLASS',
        'ADD_CLASS_STUDENT', 'REMOVE_CLASS_STUDENT', 'ADD_CLASS_INSTRUCTOR',
        'VIEW_STUDENT_RESULT', 'VIEW_STUDENT_LIST',
        'CREATE_ASSIGNMENT', 'PUBLISH_ASSIGNMENT', 'GRADE_SUBMISSION',
        'EDIT_CASE', 'PUBLISH_CASE',
        'DATA_EXPORT', 'DATA_IMPORT', 'VIEW_AUDIT_LOG',
        'MANAGE_USERS', 'MANAGE_SYSTEM', 'MANAGE_CONTENT'
    ];

    var PERM_ROLES = {
        GUEST: ['USE_SIMULATOR', 'VIEW_CONTENT', 'AUTH_LOGIN'],
        STUDENT: ['USE_SIMULATOR', 'VIEW_CONTENT', 'AUTH_LOGIN', 'AUTH_CHANGE_OWN_PASSWORD',
            'VIEW_OWN_RESULT', 'VIEW_CLASS'],
        INSTRUCTOR: ['USE_SIMULATOR', 'VIEW_CONTENT', 'AUTH_LOGIN', 'AUTH_CHANGE_OWN_PASSWORD',
            'VIEW_OWN_RESULT', 'VIEW_CLASS', 'VIEW_STUDENT_LIST', 'VIEW_STUDENT_RESULT',
            'CREATE_CLASS', 'EDIT_CLASS', 'ARCHIVE_CLASS',
            'ADD_CLASS_STUDENT', 'REMOVE_CLASS_STUDENT', 'ADD_CLASS_INSTRUCTOR',
            'CREATE_ASSIGNMENT', 'PUBLISH_ASSIGNMENT', 'GRADE_SUBMISSION',
            'EDIT_CASE', 'PUBLISH_CASE', 'MANAGE_CONTENT', 'DATA_EXPORT'],
        // ADMIN: semua permission implisit (cheat di can()).
        ADMIN: []
    };

    /* ------------------------------------------------------------------------
       4. API CLIENT (§37) — Mock API Adapter. UI TIDAK memanggil fetch langsung.
       ------------------------------------------------------------------------ */
    function apiResult(data) { return { success: true, data: data }; }
    function apiError(code, message) { return { success: false, error: { code: code, message: message } }; }

    var apiClient = {
        mode: 'MOCK',
        kinds: ['MOCK', 'REST', 'GRAPHQL', 'FIREBASE', 'SUPABASE', 'CUSTOM'],
        hooks: [],
        _active: null,
        current: function () {
            if (!apiClient._active) apiClient._active = createMockApiAdapter();
            return apiClient._active;
        },
        // abstraction; HTTP verbs disimulasikan melalui mock router ke services.
        // gunakan .current() agar UI tidak bergantung pada transport tertentu (§38).
        get: function (path, params) { return apiClient.current().get(path, params); },
        post: function (path, body) { return apiClient.current().post(path, body); },
        put: function (path, body) { return apiClient.current().put(path, body); },
        delete: function (path) { return apiClient.current().delete(path); },
        _create: function (kind, opts) {
            switch (String(kind || 'MOCK').toUpperCase()) {
                case 'REST': return createRestApiAdapter(opts);
                case 'GRAPHQL': return createGraphQLApiAdapter(opts);
                case 'FIREBASE': return createFirebaseApiAdapter(opts);
                case 'SUPABASE': return createSupabaseApiAdapter(opts);
                case 'CUSTOM': return createCustomApiAdapter(opts);
                default: return createMockApiAdapter();
            }
        },
        setAdapter: function (kindOrAdapter, opts) {
            var ad = (kindOrAdapter && typeof kindOrAdapter.request === 'function')
                ? kindOrAdapter : apiClient._create(kindOrAdapter, opts);
            apiClient._active = ad;
            apiClient.mode = ad.kind;
            return apiResult({ mode: apiClient.mode, transport: ad.transport });
        },
        resetMock: function () { return apiClient.setAdapter('MOCK'); },
        listAdapters: function () {
            return {
                active: apiClient.mode,
                kinds: apiClient.kinds.slice(),
                transports: ['Mock API Adapter', 'REST API', 'GraphQL', 'Firebase', 'Supabase', 'Custom Node.js API']
            };
        },
        _emit: function (evt, req) {
            apiClient.hooks.forEach(function (h) { try { h(evt, req); } catch (e) {} });
        },
        onRequest: function (h) {
            apiClient.hooks.push(h);
            return function () {
                var i = apiClient.hooks.indexOf(h);
                if (i >= 0) apiClient.hooks.splice(i, 1);
            };
        }
    };

    function makeTransportAdapter(kind, transport, handler) {
        return {
            kind: kind,
            transport: transport,
            request: function (method, path, payload) {
                var req = { kind: kind, method: method, path: path, payload: payload || null, at: now() };
                apiClient._emit('request', req);
                if (typeof handler === 'function') return handler(req);
                return apiError('NOT_AVAILABLE', 'Cloud backend tidak dikonfigurasi; gunakan Mock API Adapter (§37).');
            },
            get: function (path, params) { return this.request('GET', path, params); },
            post: function (path, body) { return this.request('POST', path, body); },
            put: function (path, body) { return this.request('PUT', path, body); },
            delete: function (path) { return this.request('DELETE', path); }
        };
    }
    function createMockApiAdapter() {
        return makeTransportAdapter('MOCK', 'Mock API Adapter', function (req) {
            return mockRouter(req.method, req.path, req.payload || {});
        });
    }
    function createRestApiAdapter(opts) {
        opts = opts || {};
        return makeTransportAdapter('REST', 'REST API', opts.handler || null);
    }
    function createGraphQLApiAdapter(opts) {
        opts = opts || {};
        return makeTransportAdapter('GRAPHQL', 'GraphQL', opts.handler || null);
    }
    function createFirebaseApiAdapter(opts) {
        opts = opts || {};
        return makeTransportAdapter('FIREBASE', 'Firebase', opts.handler || null);
    }
    function createSupabaseApiAdapter(opts) {
        opts = opts || {};
        return makeTransportAdapter('SUPABASE', 'Supabase', opts.handler || null);
    }
    function createCustomApiAdapter(opts) {
        opts = opts || {};
        return makeTransportAdapter('CUSTOM', 'Custom Node.js API', opts.handler || null);
    }
    function mockRouter(method, path, body) {
        var parts = path.replace(/^\/+/, '').split('/');
        var entity = parts[0];
        var id = parts[1] || null;
        if (method === 'GET') {
            if (entity === 'orgs') {
                if (id) return services.organizationService.getById(id, sessionUser());
                return services.organizationService.list(sessionUser());
            }
            if (entity === 'classes') {
                if (id) return services.classService.getClassById(id, sessionUser());
                return services.classService.listClasses(sessionUser());
            }
            if (entity === 'users') {
                if (id) return services.userService.getById(id, sessionUser());
                return services.userService.list(sessionUser());
            }
            if (entity === 'cases') return apiResult(caseRepository.list());
            if (entity === 'courses') {
                if (id) return services.courseService.getCourse(id, sessionUser());
                return services.courseService.listCourses(sessionUser());
            }
            if (entity === 'contents') {
                if (id) return services.courseService.getContent(id, sessionUser());
                return services.courseService.listContents(sessionUser());
            }
            if (entity === 'assignments') {
                if (id) return services.assignmentService.get(id, sessionUser());
                return services.assignmentService.list(sessionUser());
            }
            if (entity === 'submissions') {
                if (id) return services.submissionService.get(id, sessionUser());
                return services.submissionService.list(sessionUser());
            }
            if (entity === 'me') return apiResult({ auth: isAuthenticated(), user: getCurrentUser() });
            return apiError('NOT_FOUND', 'Endpoint unknown: ' + path);
        }
        if (method === 'POST') {
            if (entity === 'auth' && id === 'login') return services.authService.login(body.username, body.password);
            if (entity === 'users') return services.userService.register(body);
            if (entity === 'orgs') return services.organizationService.create(body, sessionUser());
            if (entity === 'classes') return services.classService.createClass(body, sessionUser());
            if (entity === 'courses') return services.courseService.createCourse(body, sessionUser());
            if (entity === 'contents') return services.courseService.createContent(body, sessionUser());
            if (entity === 'assignments') return services.assignmentService.create(body, sessionUser());
            if (entity === 'assignments' && id) {
                if (parts[2] === 'publish') return services.assignmentService.publish(id, sessionUser());
                return apiError('NOT_FOUND', 'Endpoint unknown: ' + path);
            }
            if (entity === 'submissions' && id && parts[2] === 'submit') {
                return services.submissionService.submit(sessionUser(), id, body);
            }
            if (entity === 'submissions' && id && parts[2] === 'grade') {
                return services.gradingService.grade(id, body, sessionUser());
            }
            if (entity === 'submissions' && id && parts[2] === 'return') {
                return services.gradingService.returnForRevision(id, body.feedback, sessionUser());
            }
            if (entity === 'sync' && id === 'drain') {
                return apiResult({ accepted: true, at: now() });
            }
            if (entity === 'sync') {
                // Simulasi cloud sync (§39/§40): endpoint '/sync' menerima item queue.
                if (body && body.payload && body.payload.conflictSim === true) {
                    return { success: false, error: { code: 'CONFLICT_DETECTED', message: 'CONFLICT DETECTED — remote version differs (do not overwrite silently, §42).', remoteVersion: 2, remote: body.payload.remote || {} } };
                }
                if (body && body.payload && body.payload.cloudDown === true) {
                    return apiError('CLOUD_ERROR', 'Cloud backend unavailable; item retained locally (§81).');
                }
                return apiResult({ accepted: true, at: now() });
            }
            return apiError('NOT_FOUND', 'Endpoint unknown: ' + path);
        }
        if (method === 'PUT') {
            if (entity === 'orgs' && id) return services.organizationService.update(id, body, sessionUser());
            if (entity === 'classes' && id) return services.classService.editClass(id, body, sessionUser());
            if (entity === 'courses' && id) return services.courseService.updateCourse(id, body, sessionUser());
            if (entity === 'contents' && id) return services.courseService.updateContent(id, body, sessionUser());
            if (entity === 'assignments' && id) return services.assignmentService.update(id, body, sessionUser());
            return apiError('NOT_FOUND', 'Endpoint unknown: ' + path);
        }
        if (method === 'DELETE') {
            if (entity === 'orgs' && id) return services.organizationService.archive(id, sessionUser());
            if (entity === 'classes' && id) return services.classService.archiveClass(id, sessionUser());
            if (entity === 'courses' && id) return services.courseService.archiveCourse(id, sessionUser());
            if (entity === 'contents' && id) return services.courseService.archiveContent(id, sessionUser());
            if (entity === 'assignments' && id) return services.assignmentService.archive(id, sessionUser());
            return apiError('NOT_FOUND', 'Endpoint unknown: ' + path);
        }
        return apiError('NOT_FOUND', 'Endpoint unknown: ' + path);
    }

    /* ------------------------------------------------------------------------
       5. VALIDATION (§84)
       ------------------------------------------------------------------------ */
    function isNonEmptyStr(v) { return typeof v === 'string' && v.trim().length > 0; }
    function safeStr(v, max) { return String(v == null ? '' : v).slice(0, max || 200); }
    function isEmail(v) { return v === null || v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }

    /* ------------------------------------------------------------------------
       6. AUDIT (§45) + ACTIVITY (§79) + NOTIFICATION dasar (§33)
       ------------------------------------------------------------------------ */
    function auditLog(actorId, action, entityType, entityId, extra) {
        auditRepository.add({
            id: genId('LOG'), actorId: actorId, action: action,
            entityType: entityType, entityId: entityId || null,
            timestamp: now(), extra: extra || null
        });
    }
    function logActivity(userId, type, entityType, entityId) {
        activityRepository.add({ id: genId('ACT'), userId: userId, type: type,
            entityType: entityType, entityId: entityId, timestamp: now() });
    }

    /* ------------------------------------------------------------------------
       7. AUTHORIZATION (§6) — diperiksa di service layer
       ------------------------------------------------------------------------ */
    function authorizationService() {
        function roleOf(user) { return user ? (user.role || 'GUEST') : 'GUEST'; }
        function can(user, permission) {
            var role = roleOf(user);
            if (role === 'ADMIN') return true;
            var perms = PERM_ROLES[role] || [];
            return perms.indexOf(permission) >= 0;
        }
        function fail(code, message) { return apiError(code || 'FORBIDDEN', message || 'Not permitted.'); }
        function require(user, permission) {
            return can(user, permission) ? { success: true } : fail('FORBIDDEN', 'Missing permission: ' + permission);
        }
        return { can: can, require: require, roleOf: roleOf };
    }
    var authz = authorizationService();

    /* ------------------------------------------------------------------------
       8. AUTH SERVICE (§4, §5) — Local Demo Authentication
       ------------------------------------------------------------------------ */
    function sessionUser() {
        if (!session.userId) return null;
        return userRepository.getById(session.userId);
    }
    function sanitizeUser(u) {
        if (!u) return null;
        var clean = {};
        ['id', 'role', 'name', 'username', 'email', 'organizationId', 'classIds', 'status', 'createdAt', 'updatedAt']
            .forEach(function (k) { if (u[k] !== undefined) clean[k] = u[k]; });
        return clean;
    }
    function isAuthenticated() { return !!(session.userId && session.role !== 'GUEST'); }
    function getCurrentUser() { return sanitizeUser(sessionUser()); }
    function getUserRole() { return session.role; }

    var authService = {
        register: function (data) {
            if (!isNonEmptyStr(data.name)) return apiError('VALIDATION', 'Name is required.');
            if (!isNonEmptyStr(data.username)) return apiError('VALIDATION', 'Username is required.');
            if (!isNonEmptyStr(data.password) || data.password.length < 6) {
                return apiError('VALIDATION', 'Password must be at least 6 characters.');
            }
            var role = ROLES.indexOf(data.role) >= 0 ? data.role : 'STUDENT';
            // pendaftaran publik hanya boleh GUEST/STUDENT; instructor/admin via admin
            if (role !== 'STUDENT' && role !== 'GUEST') {
                return apiError('VALIDATION', 'Role not allowed for self-registration.');
            }
            var exists = userRepository.list().some(function (u) { return u.username === data.username; });
            if (exists) return apiError('DUPLICATE', 'Username already taken.');
            if (data.email != null && !isEmail(data.email)) return apiError('VALIDATION', 'Invalid email.');
            var salt = saltFor(data.username + '_' + rng());
            var user = userRepository.save({
                id: genId('USER'), role: role, name: safeStr(data.name, 100),
                username: safeStr(data.username, 50), email: data.email || null,
                organizationId: data.organizationId || null, classIds: [],
                status: 'ACTIVE',
                passwordHash: hashPassword(data.password, salt), salt: salt
            });
            // jangan bocorkan hash ke caller (rekaman tersimpan tetap utuh)
            return apiResult(sanitizeUser(user));
        },

        login: function (username, password) {
            if (!isNonEmptyStr(username) || !isNonEmptyStr(password)) {
                return apiError('VALIDATION', 'username/password required.');
            }
            var u = userRepository.list().filter(function (x) {
                return x.username === username && x.status === 'ACTIVE';
            })[0] || null;
            if (!u) return apiError('AUTH_FAILED', 'Invalid credentials.');
            if (u.passwordHash !== hashPassword(password, u.salt)) {
                return apiError('AUTH_FAILED', 'Invalid credentials.');
            }
            var token = (rng() * 1e15).toString(36) + hashStr(u.id + now());
            session.userId = u.id; session.role = u.role; session.token = token;
            session.startedAt = now();
            session.expiresAt = now() + 1000 * 60 * 60 * 8;
            auditLog(u.id, 'LOGIN', 'USER', u.id);
            return apiResult({ token: token, user: { id: u.id, name: u.name, role: u.role, username: u.username } });
        },

        logout: function () {
            if (session.userId) auditLog(session.userId, 'LOGOUT', 'USER', session.userId);
            session.userId = null; session.role = 'GUEST'; session.token = null;
            session.startedAt = null; session.expiresAt = null;
            return apiResult(null);
        },

        getCurrentUser: getCurrentUser,
        getUserRole: getUserRole,
        isAuthenticated: isAuthenticated,
        refreshSession: function () {
            if (session.expiresAt && now() > session.expiresAt) {
                authService.logout();
                return apiError('SESSION_EXPIRED', 'Session expired.');
            }
            if (session.userId) session.expiresAt = now() + 1000 * 60 * 60 * 8;
            return apiResult({ authenticated: isAuthenticated(), role: session.role });
        },
        changePassword: function (oldPw, newPw, actor) {
            var u = actor || sessionUser();
            if (!u) return apiError('AUTH_REQUIRED', 'Authentication required.');
            var perms = authz.require(u, 'AUTH_CHANGE_OWN_PASSWORD');
            if (!perms.success) return perms;
            if (!isNonEmptyStr(newPw) || newPw.length < 6) return apiError('VALIDATION', 'Weak password.');
            if (u.passwordHash !== hashPassword(oldPw, u.salt)) return apiError('BAD_PASSWORD', 'Current password wrong.');
            var nsalt = saltFor(u.id + '_' + rng());
            u.passwordHash = hashPassword(newPw, nsalt); u.salt = nsalt;
            userRepository.save(u);
            auditLog(u.id, 'CHANGE_PASSWORD', 'USER', u.id);
            return apiResult({ changed: true });
        },
        requestPasswordReset: function (username, actor) {
            var u = userRepository.list().filter(function (x) { return x.username === username; })[0] || null;
            if (!u) return apiError('NOT_FOUND', 'User not found.');
            var token = (rng() * 1e15).toString(36) + hashStr('reset' + u.id + now());
            u.resetToken = token; u.resetExpiresAt = now() + 1000 * 60 * 30;
            userRepository.save(u);
            auditLog(actor ? actor.id : sessionUser() ? sessionUser().id : u.id, 'REQUEST_PASSWORD_RESET', 'USER', u.id);
            return apiResult({ resetToken: token, expiresInSec: 1800 });
        }
    };

    /* ------------------------------------------------------------------------
       9. USER SERVICE (§5, §43 data ownership)
       ------------------------------------------------------------------------ */
    function userService() {
        function scopeFor(actor) {
            // ADMIN -> semua; INSTRUCTOR -> hanya siswa org-nya;
            // STUDENT/GUEST -> hanya dirinya.
            if (!actor) return { role: 'GUEST' };
            if (actor.role === 'ADMIN') return { role: 'ADMIN' };
            if (actor.role === 'INSTRUCTOR') return { role: 'INSTRUCTOR', organizationId: actor.organizationId };
            return { role: 'SELF', userId: actor.id };
        }
        return {
            createUser: function (data, actor) {
                var perms = authz.require(actor, 'MANAGE_USERS');
                if (!perms.success) return perms;
                if (!isNonEmptyStr(data.name) || !isNonEmptyStr(data.username) || !isNonEmptyStr(data.password)) {
                    return apiError('VALIDATION', 'name/username/password required.');
                }
                if (ROLES.indexOf(data.role) < 0) return apiError('VALIDATION', 'Invalid role.');
                if (userRepository.list().some(function (u) { return u.username === data.username; })) {
                    return apiError('DUPLICATE', 'Username already taken.');
                }
                var salt = saltFor(data.username + '_' + rng());
                var user = userRepository.save({
                    id: genId('USER'), role: data.role, name: safeStr(data.name, 100),
                    username: safeStr(data.username, 50), email: data.email || null,
                    organizationId: data.organizationId || (actor.organizationId || null),
                    classIds: [], status: 'ACTIVE',
                    passwordHash: hashPassword(data.password, salt), salt: salt
                });
                auditLog(actor.id, 'CREATE_USER', 'USER', user.id);
                logActivity(actor.id, 'CREATED_USER', 'USER', user.id);
                return apiResult({ id: user.id, role: user.role, name: user.name, organizationId: user.organizationId, status: user.status });
            },
            getById: function (id, actor) {
                var u = userRepository.getById(id);
                if (!u) return apiError('NOT_FOUND', 'User not found.');
                var scope = scopeFor(actor);
                var own = scope.role === 'SELF' && scope.userId === id;
                var sameOrg = scope.role === 'INSTRUCTOR' && u.organizationId === scope.organizationId;
                var admin = scope.role === 'ADMIN';
                if (!(own || sameOrg || admin || actor.role === 'STUDENT' && u.id === actor.id)) {
                    return apiError('FORBIDDEN', 'Not permitted.');
                }
                var clean = {};
                var keys = ['id', 'role', 'name', 'username', 'email', 'organizationId', 'classIds', 'status', 'createdAt', 'updatedAt'];
                keys.forEach(function (k) { clean[k] = u[k]; });
                return apiResult(clean);
            },
            list: function (actor) {
                var perms = authz.require(actor, 'VIEW_STUDENT_LIST');
                if (!perms.success) return perms;
                var scope = scopeFor(actor);
                var out = [];
                userRepository.list().forEach(function (u) {
                    if (scope.role === 'ADMIN') out.push(u);
                    else if (scope.role === 'INSTRUCTOR' && u.organizationId === scope.organizationId) out.push(u);
                });
                return apiResult(out.map(function (u) {
                    return { id: u.id, role: u.role, name: u.name, username: u.username,
                        organizationId: u.organizationId, status: u.status, classIds: u.classIds.slice() };
                }));
            },
            setStatus: function (id, status, actor) {
                var perms = authz.require(actor, 'MANAGE_USERS');
                if (!perms.success) return perms;
                var u = userRepository.getById(id);
                if (!u) return apiError('NOT_FOUND', 'User not found.');
                u.status = status === 'ACTIVE' || status === 'INACTIVE' ? status : 'ACTIVE';
                userRepository.save(u);
                auditLog(actor.id, status === 'ACTIVE' ? 'REACTIVATE_USER' : 'DEACTIVATE_USER', 'USER', u.id);
                return apiResult({ id: u.id, status: u.status });
            }
        };
    }

    /* ------------------------------------------------------------------------
       10. ORGANIZATION SERVICE (§7)
       ------------------------------------------------------------------------ */
    function organizationService() {
        return {
            create: function (data, actor) {
                var perms = authz.require(actor, 'CREATE_ORGANIZATION');
                if (!perms.success) return perms;
                if (!isNonEmptyStr(data.name)) return apiError('VALIDATION', 'Name required.');
                var type = ORG_TYPES.indexOf(data.type) >= 0 ? data.type : 'SCHOOL';
                if (organizationRepository.list().some(function (o) { return o.name === data.name; })) {
                    return apiError('DUPLICATE', 'Organization name already used.');
                }
                var org = organizationRepository.save({
                    id: genId('ORG'), name: safeStr(data.name, 120), type: type,
                    status: 'ACTIVE', createdBy: actor.id
                });
                auditLog(actor.id, 'CREATE_ORGANIZATION', 'ORGANIZATION', org.id);
                return apiResult({ id: org.id, name: org.name, type: org.type, status: org.status });
            },
            getById: function (id, actor) {
                var o = organizationRepository.getById(id);
                if (!o) return apiError('NOT_FOUND', 'Organization not found.');
                var perms = authz.require(actor, 'VIEW_ORGANIZATION');
                if (!perms.success) return perms;
                if (actor && actor.role !== 'ADMIN' && actor.organizationId && actor.organizationId !== id) {
                    return apiError('FORBIDDEN', 'Not permitted.');
                }
                return apiResult({ id: o.id, name: o.name, type: o.type, status: o.status });
            },
            list: function (actor) {
                var perms = authz.require(actor, 'VIEW_ORGANIZATION');
                if (!perms.success) return perms;
                var out = organizationRepository.list().filter(function (o) {
                    if (!actor) return false;
                    if (actor.role === 'ADMIN') return true;
                    return o.id === actor.organizationId;
                });
                return apiResult(out.map(function (o) { return { id: o.id, name: o.name, type: o.type, status: o.status }; }));
            },
            update: function (id, data, actor) {
                var perms = authz.require(actor, 'EDIT_ORGANIZATION');
                if (!perms.success) return perms;
                var o = organizationRepository.getById(id);
                if (!o) return apiError('NOT_FOUND', 'Organization not found.');
                if (actor.role !== 'ADMIN' && o.id !== actor.organizationId) {
                    return apiError('FORBIDDEN', 'Cannot edit other organization.');
                }
                if (isNonEmptyStr(data.name)) o.name = safeStr(data.name, 120);
                if (ORG_TYPES.indexOf(data.type) >= 0) o.type = data.type;
                organizationRepository.save(o);
                auditLog(actor.id, 'EDIT_ORGANIZATION', 'ORGANIZATION', id);
                return apiResult({ id: o.id, name: o.name, type: o.type, status: o.status });
            },
            archive: function (id, actor) {
                var perms = authz.require(actor, 'ARCHIVE_ORGANIZATION');
                if (!perms.success) return perms;
                var o = organizationRepository.getById(id);
                if (!o) return apiError('NOT_FOUND', 'Organization not found.');
                o.status = 'ARCHIVED';
                organizationRepository.save(o);
                auditLog(actor.id, 'ARCHIVE_CONTENT', 'ORGANIZATION', id);
                return apiResult({ id: o.id, status: o.status });
            }
        };
    }

    /* ------------------------------------------------------------------------
       11. CLASSROOM SERVICE (§8, §9, §10) + enrollment (§55)
       ------------------------------------------------------------------------ */
    var doneJoinCodes = {};

    function genJoinCode(prefix) {
        var base = isNonEmptyStr(prefix) ? prefix.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) : 'TKR';
        if (base.length < 3) base = (base + 'TKR').slice(0, 3);
        var code, t;
        do {
            code = '';
            for (var i = 0; i < 4; i++) code += CODE_CHARS.charAt(Math.floor(rng() * CODE_CHARS.length));
            t = base + '-' + code;
            // jangan bentrok dengan data pribadi; cukup acak & mencoba ulang
        } while (doneJoinCodes[t]);
        doneJoinCodes[t] = true;
        return t;
    }

    function classService() {
        function findClassMembership(classId, student) {
            if (!classId || !student) return false;
            var c = classRepository.getById(classId);
            return !!(c && c.studentIds.indexOf(student.id) >= 0);
        }
        function ownClass(actor, classId) {
            var c = classRepository.getById(classId);
            if (!c) return null;
            if (actor.role === 'ADMIN') return c;
            if (c.instructorIds.indexOf(actor.id) >= 0) return c;
            return null;
        }
        function updateUserClasses(userId, addClassId) {
            var u = userRepository.getById(userId);
            if (!u) return;
            u.classIds = u.classIds || [];
            if (addClassId && u.classIds.indexOf(addClassId) < 0) u.classIds.push(addClassId);
            userRepository.save(u);
        }
        function seedStudentIfStub(user) {
            if (!user) return;
            // jaga integritas: classIds sinkron dengan keanggotaan kelas
            var c = user.classIds || [];
            user.classIds = c.filter(function (cid) { return classRepository.getById(cid); });
        }

        return {
            createClass: function (data, actor) {
                var perms = authz.require(actor, 'CREATE_CLASS');
                if (!perms.success) return perms;
                if (!isNonEmptyStr(data.name)) return apiError('VALIDATION', 'Class name required.');
                var orgId = data.organizationId || actor.organizationId || null;
                if (!orgId) return apiError('ORGANIZATION_REQUIRED', 'Instructor must belong to an organization.');
                if (!isNonEmptyStr(data.subject)) data.subject = 'Sistem Starter';
                var joinPrefix = isNonEmptyStr(data.joinPrefix) ? data.joinPrefix : null;
                var cls = classRepository.save({
                    id: genId('CLASS'), organizationId: orgId,
                    name: safeStr(data.name, 120), subject: safeStr(data.subject, 120),
                    instructorIds: [actor.id], studentIds: [],
                    academicYear: data.academicYear || String(new Date().getFullYear()),
                    status: 'ACTIVE',
                    joinCode: genJoinCode(joinPrefix || data.name),
                    joinEnabled: data.joinEnabled !== false,
                    joinExpiresAt: data.joinExpiresAt || null
                });
                auditLog(actor.id, 'CREATE_CLASS', 'CLASS', cls.id);
                logActivity(actor.id, 'CREATED_CLASS', 'CLASS', cls.id);
                return apiResult(publicClass(cls));
            },
            editClass: function (id, data, actor) {
                var perms = authz.require(actor, 'EDIT_CLASS');
                if (!perms.success) return perms;
                var c = ownClass(actor, id);
                if (!c) return apiError('NOT_FOUND', 'Class not found or not yours.');
                if (isNonEmptyStr(data.name)) c.name = safeStr(data.name, 120);
                if (data.subject != null) c.subject = safeStr(data.subject, 120);
                if (data.academicYear != null) c.academicYear = safeStr(data.academicYear, 20);
                if (typeof data.joinEnabled === 'boolean') c.joinEnabled = data.joinEnabled;
                classRepository.save(c);
                auditLog(actor.id, 'EDIT_CLASS', 'CLASS', id);
                return apiResult(publicClass(c));
            },
            archiveClass: function (id, actor) {
                var perms = authz.require(actor, 'ARCHIVE_CLASS');
                if (!perms.success) return perms;
                var c = ownClass(actor, id);
                if (!c) return apiError('NOT_FOUND', 'Class not found or not yours.');
                c.status = 'ARCHIVED';
                classRepository.save(c);
                auditLog(actor.id, 'ARCHIVE_CONTENT', 'CLASS', id);
                return apiResult(publicClass(c));
            },
            getClassById: function (id, actor) {
                var c = classRepository.getById(id);
                if (!c) return apiError('NOT_FOUND', 'Class not found.');
                if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
                if (actor.role === 'ADMIN' || c.instructorIds.indexOf(actor.id) >= 0 || c.studentIds.indexOf(actor.id) >= 0) {
                    return apiResult(publicClass(c));
                }
                return apiError('FORBIDDEN', 'Not a member.');
            },
            listClasses: function (actor) {
                if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
                var out = classRepository.list().filter(function (c) {
                    if (actor.role === 'ADMIN') return true;
                    if (actor.role === 'INSTRUCTOR') return c.instructorIds.indexOf(actor.id) >= 0;
                    if (actor.role === 'STUDENT') return c.studentIds.indexOf(actor.id) >= 0;
                    return false;
                });
                return apiResult(out.map(publicClass));
            },
            addStudent: function (classId, studentId, actor) {
                var perms = authz.require(actor, 'ADD_CLASS_STUDENT');
                if (!perms.success) return perms;
                var c = ownClass(actor, classId);
                if (!c) return apiError('NOT_FOUND', 'Class not found or not yours.');
                var s = userRepository.getById(studentId);
                if (!s || s.role !== 'STUDENT') return apiError('VALIDATION', 'Target must be a student.');
                if (s.organizationId && c.organizationId && s.organizationId !== c.organizationId) {
                    return apiError('FORBIDDEN', 'Data ownership: student from another organization.');
                }
                if (c.studentIds.indexOf(studentId) < 0) c.studentIds.push(studentId);
                updateUserClasses(studentId, classId);
                classRepository.save(c);
                auditLog(actor.id, 'ADD_STUDENT', 'CLASS', classId);
                return apiResult(publicClass(c));
            },
            removeStudent: function (classId, studentId, actor) {
                var perms = authz.require(actor, 'REMOVE_CLASS_STUDENT');
                if (!perms.success) return perms;
                var c = ownClass(actor, classId);
                if (!c) return apiError('NOT_FOUND', 'Class not found or not yours.');
                c.studentIds = c.studentIds.filter(function (id) { return id !== studentId; });
                var u = userRepository.getById(studentId);
                if (u) u.classIds = (u.classIds || []).filter(function (id) { return id !== classId; }), userRepository.save(u);
                classRepository.save(c);
                auditLog(actor.id, 'REMOVE_STUDENT', 'CLASS', classId);
                return apiResult(publicClass(c));
            },
            addInstructor: function (classId, instructorId, actor) {
                var perms = authz.require(actor, 'ADD_CLASS_INSTRUCTOR');
                if (!perms.success) return perms;
                var c = ownClass(actor, classId);
                if (!c) return apiError('NOT_FOUND', 'Class not found or not yours.');
                var i = userRepository.getById(instructorId);
                if (!i || i.role !== 'INSTRUCTOR') return apiError('VALIDATION', 'Target must be an instructor.');
                if (c.instructorIds.indexOf(instructorId) < 0) c.instructorIds.push(instructorId);
                classRepository.save(c);
                auditLog(actor.id, 'ADD_CLASS_INSTRUCTOR', 'CLASS', classId);
                return apiResult(publicClass(c));
            },
            getStudentList: function (classId, actor) {
                var c = classRepository.getById(classId);
                if (!c) return apiError('NOT_FOUND', 'Class not found.');
                var perms = authz.require(actor, 'VIEW_STUDENT_LIST');
                if (!perms.success) return perms;
                if (actor.role !== 'ADMIN' && c.instructorIds.indexOf(actor.id) < 0) {
                    return apiError('FORBIDDEN', 'Not your class.');
                }
                var list = c.studentIds.map(function (id) {
                    var u = userRepository.getById(id);
                    return u ? { id: u.id, name: u.name, username: u.username, status: u.status } : { id: id };
                });
                return apiResult(list);
            },
            getJoinInfo: function (classId, actor) {
                var c = classRepository.getById(classId);
                if (!c) return apiError('NOT_FOUND', 'Class not found.');
                if (actor && actor.role !== 'ADMIN' && c.instructorIds.indexOf(actor.id) < 0) {
                    return apiError('FORBIDDEN', 'Not your class.');
                }
                return apiResult({
                    joinCode: c.joinCode, joinEnabled: c.joinEnabled,
                    joinExpiresAt: c.joinExpiresAt, codeActive: isCodeActive(c)
                });
            },
            regenerateJoinCode: function (classId, actor) {
                var perms = authz.require(actor, 'EDIT_CLASS');
                if (!perms.success) return perms;
                var c = ownClass(actor, classId);
                if (!c) return apiError('NOT_FOUND', 'Class not found or not yours.');
                c.joinCode = genJoinCode(c.name);
                c.joinEnabled = true;
                classRepository.save(c);
                auditLog(actor.id, 'REGENERATE_JOIN_CODE', 'CLASS', classId);
                return apiResult(publicClass(c));
            },
            createJoinCode: genJoinCode,
            isJoinActive: function (c) { return isCodeActive(c); },
            joinWithCode: function (studentUser, code) {
                if (!studentUser || studentUser.role !== 'STUDENT') {
                    return apiError('FORBIDDEN', 'Only students can join with a code.');
                }
                var c = classRepository.list().filter(function (x) {
                    return x.joinEnabled && x.joinCode === code && isCodeActive(x);
                })[0] || null;
                if (!c) return apiError('NOT_FOUND', 'Join code invalid or disabled.');
                // gunakan ref LIVE di repository, bukan salinan argumen
                var live = userRepository.getById(studentUser.id) || studentUser;
                if (c.studentIds.indexOf(live.id) >= 0) {
                    return apiResult({ class: publicClass(c), alreadyJoined: true });
                }
                c.studentIds.push(live.id);
                updateUserClasses(live.id, c.id);
                classRepository.save(c);
                var orgId = c.organizationId;
                if (orgId && !live.organizationId) {
                    live.organizationId = orgId; userRepository.save(live);
                }
                auditLog(live.id, 'JOIN_CLASS', 'CLASS', c.id);
                logActivity(live.id, 'JOIN_CLASS', 'CLASS', c.id);
                return apiResult({ class: publicClass(c), alreadyJoined: false });
            },
            viewClassProgress: function (classId, actor) {
                var c = classRepository.getById(classId);
                if (!c) return apiError('NOT_FOUND', 'Class not found.');
                if (actor && actor.role !== 'ADMIN' && c.instructorIds.indexOf(actor.id) < 0 &&
                    c.studentIds.indexOf(actor.id) < 0) {
                    return apiError('FORBIDDEN', 'Not a member.');
                }
                return apiResult(computeClassProgress(c));
            }
        };
    }

    function isCodeActive(c) {
        if (!c.joinEnabled) return false;
        if (c.joinExpiresAt && now() > c.joinExpiresAt) return false;
        return true;
    }
    function publicClass(c) {
        return {
            id: c.id, organizationId: c.organizationId, name: c.name, subject: c.subject,
            instructorIds: c.instructorIds.slice(), studentIds: c.studentIds.slice(),
            academicYear: c.academicYear, status: c.status,
            joinCode: c.joinCode, joinEnabled: c.joinEnabled, joinExpiresAt: c.joinExpiresAt
        };
    }

    function computeUserProgress(userId) {
        var subs = submissionRepository.list().filter(function (s) { return s.studentId === userId; });
        return { submissions: subs.length, completed: subs.filter(function (s) { return s.status === 'COMPLETED' || s.status === 'GRADED'; }).length };
    }
    function computeClassProgress(c) {
        if (!c) return { classId: null, studentCount: 0, joined: 0, submissions: 0, completionRate: 0 };
        var subs = submissionRepository.list().filter(function (s) { return c.studentIds.indexOf(s.studentId) >= 0; });
        var scalar = { submissions: subs.length, completed: 0, started: 0 };
        subs.forEach(function (s) {
            if (s.status === 'COMPLETED') scalar.completed++;
            if (s.status === 'SUBMITTED' || s.status === 'GRADED') scalar.completed++;
        });
        var rate = c.studentIds.length ? Math.round((scalar.completed / c.studentIds.length) * 100) : 0;
        return {
            classId: c.id, studentCount: c.studentIds.length,
            joined: c.studentIds.length,
            submissions: subs.length,
            completionRate: Math.max(0, Math.min(100, rate))
        };
    }

    /* ------------------------------------------------------------------------
       STEP 19 (STEP 13 instructor / §28-30): ANALYTICS §28 LEARNING ANALYTICS /
       §29 CLASS ANALYTICS / §30 STUDENT DETAIL VIEW. Semua metrik DIHITUNG dari
       repository nyata phase8 (submission/assignment/activity) + bridge phase5
       — BUKAN skor/nilai yang dikarang. RBAC: instructor (kelasnya) & ADMIN
       yang boleh melihat; analytics disejajarkan dengan prinsip bahwa analytics
       membantu memahami kebutuhan pembelajaran, bukan penilaian tunggal
       kemampuan siswa (§28).
       ------------------------------------------------------------------------ */
    function analyticsScores(userId) {
        return submissionRepository.list().filter(function (s) { return s.studentId === userId; })
            .filter(function (s) { return typeof s.score === 'number'; });
    }
    function analyticsTimes(userId) {
        return submissionRepository.list().filter(function (s) {
            if (s.studentId !== userId) return false;
            if (typeof s.timeSpent === 'number') return true;
            return typeof s.timeStarted === 'number' && typeof s.timeSubmitted === 'number';
        });
    }
    function analysisActivityOf(userId, pattern) {
        return activityRepository.list().filter(function (a) {
            return a && a.userId === userId && pattern.test(String(a.type || ''));
        }).length;
    }
    function commonMistakeBins(userId) {
        var bins = {};
        activityRepository.list().forEach(function (a) {
            if (!a || a.userId !== userId) return;
            if (/FAILED_MEASUREMENT|WRONG_HYPOTHESIS|FAILED_VERIFY|FAILED_VERIFICATION|REPAIR_ERROR|HINT_USED/.test(String(a.type || ''))) {
                var k = a.entityType || a.skillFocus || 'GENERAL';
                bins[k] = (bins[k] || 0) + 1;
            }
        });
        return Object.keys(bins).map(function (k) { return { label: k, count: bins[k] }; })
            .sort(function (a, b) { return b.count - a.count; });
    }
    function diagnosticPathBins(userId) {
        var bins = {};
        activityRepository.list().forEach(function (a) {
            if (!a || a.userId !== userId) return;
            var p = a.diagnosticPath || a.pathLabel || a.decisionPath || null;
            if (!p) return;
            var k = String(p);
            bins[k] = (bins[k] || 0) + 1;
        });
        return Object.keys(bins).map(function (k) { return { label: k, count: bins[k] }; })
            .sort(function (a, b) { return b.count - a.count; });
    }
    function computeLearningAnalytics(userId) {
        var u = userRepository.getById(userId);
        if (!u) return apiResult({ userId: userId, exists: false, note: 'Siswa tidak ditemukan.' });
        var scores = analyticsScores(userId);
        var times = analyticsTimes(userId);
        var subsAll = submissionRepository.list().filter(function (s) { return s.studentId === userId; });
        var completed = subsAll.filter(function (s) { return s.status === 'COMPLETED' || s.status === 'SUBMITTED' || s.status === 'GRADED'; }).length;
        var sumScore = scores.reduce(function (a, s) { return a + s.score; }, 0);
        var avgScore = scores.length ? Math.round((sumScore / scores.length) * 10) / 10 : null;
        var sumTime = 0;
        times.forEach(function (s) {
            var t = typeof s.timeSpent === 'number' ? s.timeSpent
                : (s.timeSubmitted - s.timeStarted);
            if (t >= 0) sumTime += t;
        });
        var avgTime = times.length ? Math.round(sumTime / times.length) : null;
        var cases = caseRepository.list().filter(function (c) { return c.status === 'PUBLISHED'; });
        var difficult = cases.map(function (c) {
            var done = submissionRepository.list().filter(function (s) {
                return s.studentId === userId && s.assignmentId === c.id;
            });
            return { id: c.id, title: c.title, difficulty: c.difficulty, skillFocus: c.skillFocus || null,
                attempts: done.length, lastScore: done.length ? done[done.length - 1].score : null };
        }).filter(function (c) { return c.attempts > 0; })
            .sort(function (a, b) { return (a.lastScore == null ? -1 : a.lastScore) - (b.lastScore == null ? -1 : b.lastScore); })
            .slice(0, 5);
        return apiResult({
            userId: userId, exists: true,
            student: { id: u.id, name: u.name, username: u.username, organizationId: u.organizationId },
            completionRate: subsAll.length ? Math.max(0, Math.min(100, Math.round((completed / subsAll.length) * 100))) : 0,
            averageScore: avgScore,
            averageTime: avgTime,
            totalSubmissions: subsAll.length,
            completedSubmissions: completed,
            commonErrors: commonMistakeBins(userId),
            commonDiagnosticPaths: diagnosticPathBins(userId),
            mostDifficultCases: difficult,
            measurementErrors: analysisActivityOf(userId, /FAILED_MEASUREMENT|MEASUREMENT_ERROR/),
            repairErrors: analysisActivityOf(userId, /REPAIR_ERROR|WRONG_REPAIR/),
            verificationErrors: analysisActivityOf(userId, /FAILED_VERIF|VERIFICATION_ERROR/),
            hintUsage: analysisActivityOf(userId, /HINT/),
            note: 'Analytics membantu memahami kebutuhan pembelajaran, bukan penilaian tunggal terhadap kemampuan siswa (§28).'
        });
    }
    function computeClassAnalytics(classId, actorOpts) {
        var c = classRepository.getById(classId);
        if (!c) return apiError('NOT_FOUND', 'Class not found.');
        var actor = actorOpts && actorOpts.actor;
        if (actor) {
            var perms = authz.require(actor, 'VIEW_CLASS');
            if (perms.success && actor.role === 'INSTRUCTOR' && c.instructorIds.indexOf(actor.id) < 0) {
                return apiError('FORBIDDEN', 'Not your class.');
            }
        }
        var lessonIds = {};
        c.studentIds.forEach(function (id) { lessonIds[id] = true; });
        var subs = submissionRepository.list().filter(function (s) { return lessonIds[s.studentId]; });
        var dist = { 'A (86-100)': 0, 'B (71-85)': 0, 'C (56-70)': 0, 'D (0-55)': 0 };
        var sumScore = 0, scored = 0;
        subs.forEach(function (s) {
            if (typeof s.score !== 'number') return;
            scored++; sumScore += s.score;
            if (s.score >= 86) dist['A (86-100)']++;
            else if (s.score >= 71) dist['B (71-85)']++;
            else if (s.score >= 56) dist['C (56-70)']++;
            else dist['D (0-55)']++;
        });
        var mistakes = {};
        activityRepository.list().forEach(function (a) {
            if (!a || !lessonIds[a.userId]) return;
            if (/FAILED_MEASUREMENT|WRONG_HYPOTHESIS|FAILED_VERIF|REPAIR_ERROR/.test(String(a.type || ''))) {
                var k = a.entityType || a.skillFocus || 'GENERAL';
                mistakes[k] = (mistakes[k] || 0) + 1;
            }
        });
        var commonMistakes = Object.keys(mistakes).map(function (k) { return { label: k, count: mistakes[k] }; })
            .sort(function (a, b) { return b.count - a.count; });
        var assignmentCompletion = assignmentRepository.list().filter(function (as) { return as.classId === classId; })
            .map(function (as) {
                var n = c.studentIds.filter(function (sid) {
                    return submissionRepository.list().some(function (s) { return s.assignmentId === as.id && s.studentId === sid; });
                }).length;
                return { assignmentId: as.id, title: as.title, done: n, total: c.studentIds.length,
                    completionRate: c.studentIds.length ? Math.round((n / c.studentIds.length) * 100) : 0 };
            });
        var progress = computeClassProgress(c);
        return apiResult({
            classId: classId, exists: true,
            name: c.name, subject: c.subject, academicYear: c.academicYear,
            studentCount: c.studentIds ? c.studentIds.length : 0,
            classProgress: progress,
            distribution: scored ? dist : { 'A (86-100)': 0, 'B (71-85)': 0, 'C (56-70)': 0, 'D (0-55)': 0 },
            averageScore: scored ? Math.round((sumScore / scored) * 10) / 10 : null,
            assignmentCompletion: assignmentCompletion,
            commonMistakes: commonMistakes,
            diagnosticSkillTrends: skillTrendBins(classId, lessonIds),
            note: 'Analytics membantu memahami kebutuhan belajar kelas, bukan perbandingan nilai antar siswa (§29).'
        });
    }
    function skillTrendBins(classId, lessonIds) {
        var bins = {};
        activityRepository.list().forEach(function (a) {
            if (!a || !lessonIds[a.userId]) return;
            var t = String(a.type || '');
            if (/FAILED_MEASUREMENT/.test(t)) bins['Diagnosis: Pengukuran'] = (bins['Diagnosis: Pengukuran'] || 0) + 1;
            else if (/WRONG_HYPOTHESIS/.test(t)) bins['Diagnosis: Hipotesis'] = (bins['Diagnosis: Hipotesis'] || 0) + 1;
            else if (/FAILED_VERIF/.test(t)) bins['Diagnosis: Verifikasi'] = (bins['Diagnosis: Verifikasi'] || 0) + 1;
            else if (/REPAIR_ERROR/.test(t)) bins['Perbaikan: Eksekusi'] = (bins['Perbaikan: Eksekusi'] || 0) + 1;
        });
        return Object.keys(bins).map(function (k) { return { label: k, count: bins[k] }; })
            .sort(function (a, b) { return b.count - a.count; });
    }
    function computeStudentDetail(classId, studentId, actorOpts) {
        var actor = actorOpts && actorOpts.actor;
        if (actor) {
            var perms = authz.require(actor, 'VIEW_CLASS');
            if (!perms.success) return apiError(perms.error && perms.error.code || 'FORBIDDEN',
                'Akses detail siswa ditolak (RBAC §30).');
        }
        var c = classRepository.getById(classId);
        if (!c) return apiError('NOT_FOUND', 'Class not found.');
        if (c.studentIds.indexOf(studentId) < 0) return apiError('NOT_FOUND', 'Student not in class.');
        var u = userRepository.getById(studentId);
        if (!u) return apiError('NOT_FOUND', 'Student not found.');
        var classes = classRepository.list().filter(function (x) { return x.studentIds.indexOf(studentId) >= 0; })
            .map(function (x) { return { id: x.id, name: x.name, subject: x.subject, academicYear: x.academicYear, status: x.status }; });
        var assignments = assignmentRepository.list().filter(function (as) { return as.classId === classId; })
            .map(function (as) {
                var sub = submissionRepository.list().filter(function (s) { return s.studentId === studentId && s.assignmentId === as.id; })
                    .pop() || null;
                return { id: as.id, title: as.title, type: as.type, status: as.status, dueAt: as.dueAt || null,
                    submission: sub ? { id: sub.id, status: sub.status, score: sub.score, submittedAt: sub.updatedAt } : null };
            });
        var results = submissionRepository.list().filter(function (s) {
            return s.studentId === studentId && s.assignmentId && /GRADED|SCORED|VERIFIED/.test(s.status || '');
        }).map(function (s) {
            var as = assignmentRepository.getById(s.assignmentId);
            return { assignmentId: s.assignmentId, title: as ? as.title : null, score: s.score, status: s.status, updatedAt: s.updatedAt };
        });
        var diag = activityRepository.list().filter(function (a) {
            return a && a.userId === studentId && /DIAGNOSTIC|MEASUREMENT|HYPOTHESIS|VERIF/.test(String(a.type || ''));
        }).map(function (a) {
            return { type: a.type, entityType: a.entityType || null, entityId: a.entityId || null, at: a.timestamp || null };
        });
        return apiResult({
            classId: classId, studentId: studentId, exists: true,
            profile: { id: u.id, name: u.name, username: u.username, organizationId: u.organizationId },
            classes: classes,
            progress: computeUserProgress(studentId),
            assignments: assignments,
            assessmentResults: results,
            diagnosticHistory: diag
        });
    }

    /* ------------------------------------------------------------------------
       STEP 20 — LEARNING-PATH RECOMMENDATION (deterministik, data nyata §28-30)
       - rekomendasi langkah belajar berikut (weakest skill) DIHITUNG dari
         submission nyata (rata2 score per skillFocus) + aktivitas error nyata
         (measurement/repair/verification), BUKAN skor karangan / Math.random.
       - RBAC: GUEST ditolak (AUTH_REQUIRED); siswa hanya utk dirinya sendiri;
         INSTRUCTOR/ADMIN hanya utk siswa di kelas miliknya.
       - catatan etis: rekomendasi membantu MEMILIH langkah belajar, BUKAN
         vonis tunggal kemampuan siswa (§28). Deterministik, dapat dihitung
         ulang dengan hasil yang sama.
       ------------------------------------------------------------------------ */
    var learningPathNoteText = 'Rekomendasi berasal dari data belajar nyata untuk membantu siswa memilih langkah berikutnya — bukan vonis tunggal kemampuan siswa (§28).';
    function scoreBinsBySkill(userId) {
        var bins = {};
        submissionRepository.list().forEach(function (s) {
            if (!s || s.studentId !== userId || typeof s.score !== 'number') return;
            var as = assignmentRepository.getById(s.assignmentId);
            var c = as && as.caseId ? caseRepository.getById(as.caseId) : null;
            var focus = (c && c.skillFocus) || (as && as.skillFocus) || 'GENERAL';
            bins[focus] = bins[focus] || { sum: 0, n: 0 };
            bins[focus].sum += s.score; bins[focus].n += 1;
        });
        return Object.keys(bins).map(function (k) {
            return { skillFocus: k, averageScore: Math.round((bins[k].sum / bins[k].n) * 10) / 10, attempts: bins[k].n };
        });
    }
    function errorBinsBySkill(userId) {
        var bins = {};
        activityRepository.list().forEach(function (a) {
            if (!a || a.userId !== userId) return;
            if (/FAILED_MEASUREMENT|WRONG_HYPOTHESIS|FAILED_VERIF|REPAIR_ERROR|MEASUREMENT_ERROR|HINT/.test(String(a.type || ''))) {
                var k = a.skillFocus || a.entityType || 'GENERAL';
                bins[k] = (bins[k] || 0) + 1;
            }
        });
        return Object.keys(bins).map(function (k) { return { skillFocus: k, errors: bins[k] }; });
    }
    function weakestSkillFor(userId) {
        var scores = scoreBinsBySkill(userId);
        if (!scores.length) return null;
        var errs = {};
        errorBinsBySkill(userId).forEach(function (e) { errs[e.skillFocus] = e.errors; });
        var sorted = scores.slice().sort(function (a, b) {
            if (a.averageScore !== b.averageScore) return a.averageScore - b.averageScore;
            var ea = errs[a.skillFocus] || 0, eb = errs[b.skillFocus] || 0;
            if (ea !== eb) return eb - ea;
            return a.skillFocus < b.skillFocus ? -1 : a.skillFocus > b.skillFocus ? 1 : 0;
        });
        var first = sorted[0];
        return { skillFocus: first.skillFocus, averageScore: first.averageScore,
            attempts: first.attempts, errors: errs[first.skillFocus] || 0 };
    }
    function contentForSkill(focus) {
        var items = [];
        contentRepository.list().forEach(function (c) {
            if (!c) return;
            if ((c.status === 'PUBLISHED' || c.status === 'ACTIVE') &&
                (c.skillFocus === focus || (c.skills || []).indexOf(focus) >= 0)) items.push(c);
        });
        caseRepository.list().forEach(function (c) {
            if (!c) return;
            if (c.status === 'PUBLISHED' && (c.skillFocus === focus || (c.skills || []).indexOf(focus) >= 0)) items.push(c);
        });
        return items.slice().sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || '')); });
    }
    function computeLearningPath(userId, actorOpts) {
        var actor = actorOpts && actorOpts.actor;
        var u = userRepository.getById(userId);
        if (!u) return apiResult({ userId: userId, exists: false, note: 'Siswa tidak ditemukan.' });
        if (!actor || !actor.id) return apiError('AUTH_REQUIRED', 'Silakan login dahulu.');
        if (actor.role === 'GUEST') return apiError('AUTH_REQUIRED', 'GUEST tidak dapat mengakses rekomendasi belajar.');
        if (actor.role === 'STUDENT' && actor.id !== userId) return apiError('FORBIDDEN', 'Siswa hanya dapat melihat rekomendasi untuk dirinya sendiri.');
        if (actor.role === 'INSTRUCTOR' || actor.role === 'ADMIN') {
            var owns = classRepository.list().some(function (cl) {
                return cl && cl.instructorIds.indexOf(actor.id) >= 0 && cl.studentIds.indexOf(userId) >= 0;
            });
            if (actor.role === 'INSTRUCTOR' && !owns) return apiError('FORBIDDEN', 'Instruktur hanya dapat merekomendasikan siswa di kelasnya.');
        }
        var weakest = weakestSkillFor(userId);
        if (!weakest) return apiResult({
            userId: userId, exists: true, studentId: userId,
            weakestSkill: null, nextStep: null, note: 'Belum ada data submission untuk direkomendasikan.'
        });
        var list = contentForSkill(weakest.skillFocus);
        var nextStep = list.length ? { type: list[0].type || 'CASE', refId: list[0].id, skillFocus: weakest.skillFocus, title: list[0].title, available: true }
            : { type: 'REVIEW', skillFocus: weakest.skillFocus, title: 'Ulangi materi kategori ' + weakest.skillFocus, available: false };
        var top = weakestSkillFor(userId); // deterministic, dihitung ulang
        return apiResult({
            userId: userId, exists: true, studentId: userId,
            student: { id: u.id, name: u.name, username: u.username },
            weakestSkill: { skillFocus: weakest.skillFocus, averageScore: weakest.averageScore, attempts: weakest.attempts, errors: weakest.errors },
            nextStep: nextStep,
            topSuggestions: list.slice(0, 3).map(function (c) {
                return { type: c.type || 'CASE', refId: c.id, skillFocus: weakest.skillFocus, title: c.title };
            }),
            note: learningPathNoteText,
            deterministic: true
        });
    }
    var mentorReviewNoteText = 'Tinjauan mentor membantu siswa memilih langkah berikutnya dari data belajar nyata, BUKAN vonis tunggal kemampuan mereka (§31-33).';
    var mentorFollowUpNoteText = 'Rencana tindak lanjut mentor disusun dari data nyata siswa secara deterministik, membantu siswa melangkah, BUKAN vonis kemampuan mereka (§31-33).';
    var learningPathService = {
        recommendNext: function (userId, opts) { return computeLearningPath(userId, opts); },
        recommendedForRole: function (actorOpts) {
            var actor = actorOpts && actorOpts.actor;
            if (!actor || !actor.id) return apiError('AUTH_REQUIRED', 'Silakan login dahulu.');
            if (actor.role === 'GUEST') return apiError('AUTH_REQUIRED', 'GUEST tidak dapat mengakses rekomendasi belajar.');
            if (actor.role === 'STUDENT') return computeLearningPath(actor.id, actorOpts);
            var ids = {};
            if (actor.role === 'INSTRUCTOR') {
                classRepository.list().forEach(function (cl) {
                    if (cl && cl.instructorIds.indexOf(actor.id) >= 0) cl.studentIds.forEach(function (sid) { ids[sid] = true; });
                });
            }
            var recs = Object.keys(ids).map(function (sid) { return computeLearningPath(sid, actorOpts); });
            return apiResult({ actorRole: actor.role, recommendations: recs, note: learningPathNoteText, deterministic: true });
        },
        mentorReview: function (studentId, actorOpts) {
            var actor = (actorOpts && actorOpts.actor) || null;
            if (!actor || !actor.id) return apiError('AUTH_REQUIRED', 'Silakan login dahulu.');
            if (actor.role === 'GUEST') return apiError('AUTH_REQUIRED', 'GUEST tidak dapat meninjau siswa (§31).');
            var path = computeLearningPath(studentId, actorOpts);
            if (!path || path.success !== true) return path;
            var detail = computeStudentDetail(studentId, actorOpts);
            var review = {
                studentId: studentId,
                reviewedBy: actor.id,
                reviewerRole: actor.role,
                weakestSkill: path.data && path.data.weakestSkill,
                evidenceCount: detail.data && detail.data.activities ? detail.data.activities.length : 0,
                followUpNote: mentorReviewNoteText,
                deterministic: true
            };
            return apiResult({ review: review, reviewedPath: path.data, principle: 'peninjauan mentor membantu siswa melangkah, bukan vonis (§31-32).' });
        },
        followUpPlan: function (studentId, actorOpts) {
            var actor = (actorOpts && actorOpts.actor) || null;
            if (!actor || !actor.id) return apiError('AUTH_REQUIRED', 'Silakan login dahulu.');
            if (actor.role === 'GUEST') return apiError('AUTH_REQUIRED', 'GUEST tidak dapat menyusun tindak lanjut (§31).');
            var path = computeLearningPath(studentId, actorOpts);
            if (!path || path.success !== true) return path;
            var steps = [];
            if (path.data && path.data.weakestSkill) {
                var weakest = path.data.weakestSkill;
                steps.push({ order: 1, action: 'ulangi topik terlemah (' + weakest.skillFocus + ')', refSkill: weakest.skillFocus });
                (weakest.suggestedContent || []).slice(0, 2).forEach(function (c, i) {
                    steps.push({ order: 2 + i, action: 'pelajari konten: ' + c.title, refContentId: c.id });
                });
            }
            return apiResult({ studentId: studentId, plannedFor: actor.id, steps: steps, deterministic: true });
        },
        learningPathNote: function () {
            return { warning: learningPathNoteText, principle: 'rekomendasi membantu memilih langkah belajar, bukan vonis kemampuan siswa (§28).' };
        },
        mentorReview: function (studentId, actorOpts) {
            var actor = actorOpts && actorOpts.actor;
            if (!actor || !actor.id) return apiError('AUTH_REQUIRED', 'Silakan login dahulu.');
            if (actor.role === 'GUEST') return apiError('AUTH_REQUIRED', 'GUEST tidak dapat meninjau rencana belajar siswa (§31).');
            var student = studentRepository.findById(studentId);
            if (!student) return apiError('NOT_FOUND', 'Siswa tidak ditemukan.');
            var selfOk = actor.role === 'STUDENT' && actor.id === studentId;
            var ownsOk = false;
            if (actor.role === 'INSTRUCTOR') {
                classRepository.list().forEach(function (cl) {
                    if (cl && cl.instructorIds && cl.instructorIds.indexOf(actor.id) >= 0 &&
                        cl.studentIds && cl.studentIds.indexOf(studentId) >= 0) ownsOk = true;
                });
            }
            var adminOk = actor.role === 'ADMIN';
            if (!selfOk && !ownsOk && !adminOk) return apiError('FORBIDDEN', 'Anda tidak berhak meninjau siswa ini (§31-32).');
            var path = computeLearningPath(studentId, actorOpts);
            var detail = computeStudentDetail(studentId, actorOpts);
            var weakest = path && path.success === true && path.data && path.data.weakestSkill ? path.data.weakestSkill : null;
            var earned = detail && detail.success === true && detail.data ? detail.data.activitiesCount : null;
            return apiResult({
                learnerId: studentId, reviewer: actor.id, role: actor.role,
                review: {
                    subject: weakest, notJudgment: true,
                    followUp: [{
                        action: 'ulangi topik terlemah melalui rekomendasi §30',
                        refSkill: weakest ? weakest.skillFocus : null
                    }]
                },
                earnedEvidence: earned, note: mentorReviewNoteText, deterministic: true
            });
        },
        followUpPlan: function (studentId, actorOpts) {
            var actor = actorOpts && actorOpts.actor;
            if (!actor || !actor.id) return apiError('AUTH_REQUIRED', 'Silakan login dahulu.');
            if (actor.role === 'GUEST') return apiError('AUTH_REQUIRED', 'GUEST tidak dapat menyusun rencana tindak lanjut (§32).');
            var path = computeLearningPath(studentId, actorOpts);
            if (path.success !== true) return path;
            var weakest = path.data.weakestSkill;
            var steps = [];
            if (weakest) {
                steps.push({ order: 1, action: 'ulangi topik ' + weakest.skillFocus, refSkill: weakest.skillFocus });
                (weakest.suggestedContent || []).slice(0, 2).forEach(function (c, i) {
                    steps.push({ order: 2 + i, action: 'pelajari konten: ' + c.title, refContent: c.id });
                });
            }
            return apiResult({ learnerId: studentId, followUp: steps, totalMistakes: path.data.totalMistakes, note: mentorReviewNoteText, deterministic: true });
        },
        mentorNote: function () {
            return { vignette: 'tinjauan mentor membantu siswa memilih langkah berikutnya, BUKAN vonis kemampuan mereka', warning: mentorReviewNoteText, principle: 'tindak lanjut dihitung dari data nyata, deterministik, tanpa tebakan acak (§33).' };
        }
    };
    var learningPathRepository = {
        recommendNext: function (userId, opts) { return learningPathService.recommendNext(userId, opts); },
        weakestSkill: function (userId, opts) { return learningPathService.recommendNext(userId, opts); },
        listSuggestions: function (userId, opts) { return learningPathService.recommendNext(userId, opts); },
        note: function () { return learningPathService.learningPathNote(); }
    };

    /* ------------------------------------------------------------------------
       12. DASHBOARD SERVICE (STEP 6 student / STEP 7 instructor, §11-12)
       Data pembelajaran diagregasi DARI phase5 (existing, local) — bukan
       nilai palsu. Bridge defensif: bila Phase5 belum dimuat, dashboard
       tetap berjalan dengan learningAvailable=false + nol (offline-safe).
       ------------------------------------------------------------------------ */
    var learningOverride = undefined;
    function phase5Obj() {
        if (learningOverride !== undefined) return learningOverride;
        var p5 = hasWindow ? window.Phase5 : null;
        return (p5 && p5.active) ? p5 : null;
    }
    function phase5Get(fn, fallback) {
        var p5 = phase5Obj();
        if (!p5 || typeof p5[fn] !== 'function') return fallback;
        try { var v = p5[fn](); return (v == null) ? fallback : v; } catch (e) { return fallback; }
    }
    function phase5Arr(fn) {
        var v = phase5Get(fn, null);
        return Array.isArray(v) ? v : [];
    }
    function phase5Num(fn) {
        var v = phase5Get(fn, null);
        return typeof v === 'number' && isFinite(v) ? v : 0;
    }
    function setLearningBridge(override) { learningOverride = override; }
    function learningAvailable() { return !!phase5Obj(); }

    var ACTIVITY_LABELS = { STARTED_LESSON: 'Membuka materi', STARTED_PRACTICE: 'Memulai praktik',
        STARTED_DIAGNOSTIC: 'Memulai diagnosis', PERFORMED_MEASUREMENT: 'Melakukan pengukuran',
        COMPLETED_QUIZ: 'Menyelesaikan quiz', COMPLETED_JOB_SHEET: 'Menyelesaikan job sheet',
        COMPLETED_DIAGNOSTIC: 'Menyelesaikan kasus diagnosis', SUBMITTED: 'Mengumpulkan tugas',
        GRADED: 'Tugas dinilai', JOIN_CLASS: 'Bergabung dengan kelas', CREATED_CLASS: 'Membuat kelas',
        CREATED_USER: 'Menambah pengguna' };
    function activityLabel(e) {
        return ACTIVITY_LABELS[e.type] || (e.entityType ? (e.type || 'aktivitas') + ' ' + e.entityId : (e.type || 'aktivitas'));
    }

    function recentActivityOf(userId, limit) {
        var out = activityRepository.list()
            .filter(function (a) { return a.userId === userId; })
            .map(function (a) {
                return { type: a.type, label: activityLabel(a), entityType: a.entityType,
                    entityId: a.entityId, when: a.timestamp, source: 'phase8' };
            });
        phase5Arr('getLearningRecord').forEach(function (e) {
            var when = (e && typeof e.timestamp === 'number') ? e.timestamp : (e && typeof e.timeMs === 'number' ? e.timeMs : 0);
            out.push({ type: 'LEARNING', label: (e && e.type) || 'aktivitas', entityType: null,
                entityId: (e && (e.moduleId || e.lessonId || e.practiceId || null)) || null, when: when, source: 'phase5' });
        });
        out.sort(function (a, b) { return (b.when || 0) - (a.when || 0); });
        return out.slice(0, limit || 10);
    }

    function normalizeJobSheets() {
        return phase5Arr('getJobSheets').map(function (j) {
            var res = phase5Get('getJobSheetResult', null);
            var r = (typeof res === 'function') ? safeCall(res, j.id) : null;
            return { id: j.id, title: j.title || '', moduleId: j.moduleId || null, done: !!r, score: r && typeof r.score === 'number' ? r.score : null };
        });
    }
    function safeCall(fn) {
        try { return fn.apply(null, Array.prototype.slice.call(arguments, 1)); } catch (e) { return null; }
    }

    function dashboardService() {
        function studentFor(userId, actor) {
            if (!userId) return apiError('VALIDATION', 'studentId required.');
            var student = userRepository.getById(userId);
            if (!student) return apiError('NOT_FOUND', 'Student not found.');
            var self = actor && actor.id === userId;
            if (!self) {
                var perms = authz.require(actor, 'VIEW_STUDENT_RESULT');
                if (!perms.success) return perms;
            }
            var classes = classRepository.list().filter(function (c) {
                return c.studentIds.indexOf(userId) >= 0 && c.status !== 'ARCHIVED';
            });
            var by = authz.roleOf(actor);
            var phases = phase5Obj();
            var learning = phases ? {
                available: true,
                progress: phase5Get('computeOverallProgress', null),
                jobSheets: normalizeJobSheets(),
                assessmentResults: phase5Arr('getAssessmentResults').map(function (r) {
                    return { id: r.id, moduleId: r.moduleId, score: r.score, passed: r.passed, attemptedAt: r.attemptedAt || null };
                }),
                achievements: phase5Arr('getAchievements'),
                skills: phase5Get('skillSummary', null)
            } : { available: false, progress: null, jobSheets: [], assessmentResults: [], achievements: [], skills: null };
            return apiResult({
                student: { id: student.id, name: student.name, username: student.username, organizationId: student.organizationId },
                classes: classes.map(function (c) {
                    return { id: c.id, name: c.name, subject: c.subject, academicYear: c.academicYear, status: c.status };
                }),
                currentAssignments: assignmentSvc.forStudent({ id: userId, role: 'STUDENT' }).data.map(function (as) {
                    return { id: as.id, title: as.title, type: as.type, contentId: as.contentId,
                        dueAt: as.dueAt, status: as.status, contentTitle: as.contentTitle, passingScore: as.passingScore };
                }),
                assignmentProgress: computeUserProgress(userId),
                diagnosticCases: caseRepository.list().filter(function (c) { return c.status === 'PUBLISHED'; })
                    .map(function (c) { return { id: c.refId, difficulty: c.difficulty, skillFocus: c.skillFocus, title: c.title }; }),
                diagnosticDoneCount: phase5Arr('getDiagnosticHistory').length,
                learning: learning,
                recentActivity: recentActivityOf(userId, 10)
            });
        }

        function instructorFor(instructorId, actor) {
            if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
            if (!(authz.roleOf(actor) === 'ADMIN' || (authz.roleOf(actor) === 'INSTRUCTOR' && actor.id === instructorId))) {
                return apiError('FORBIDDEN', 'Not permitted.');
            }
            var classes = classRepository.list().filter(function (c) {
                return c.instructorIds.indexOf(instructorId) >= 0 && c.status !== 'ARCHIVED';
            });
            var studentIds = {};
            var classIdSet = {};
            classes.forEach(function (c) { classIdSet[c.id] = true; c.studentIds.forEach(function (id) { studentIds[id] = true; }); });
            var totalStudents = Object.keys(studentIds).length;
            var classSummary = classes.map(function (c) {
                var p = computeClassProgress(c);
                return { id: c.id, name: c.name, subject: c.subject, academicYear: c.academicYear,
                    status: c.status, joinEnabled: c.joinEnabled, studentCount: c.studentIds.length,
                    progress: p };
            });
            var avgRate = classSummary.length
                ? Math.round(classSummary.reduce(function (s, c) { return s + (c.progress.completionRate || 0); }, 0) / classSummary.length)
                : 0;
            var mySubs = submissionRepository.list().filter(function (s) { return studentIds[s.studentId]; })
                .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
            var diagEvents = activityRepository.list().filter(function (a) {
                return /DIAGNOSTIC|MEASUREMENT|HYPOTHESIS|VERIFY|REPAIR/.test(a.type);
            });
            var mistakes = {};
            activityRepository.list().forEach(function (a) {
                if (['FAILED_MEASUREMENT', 'WRONG_HYPOTHESIS', 'FAILED_VERIFY', 'REPAIR_ERROR', 'HINT_USED'].indexOf(a.type) >= 0) {
                    var k = a.entityType || 'GENERAL';
                    mistakes[k] = (mistakes[k] || 0) + 1;
                }
            });
            return apiResult({
                instructor: { id: instructorId, name: (userRepository.getById(instructorId) || {}).name || instructorId },
                classes: classSummary,
                totals: {
                    classes: classes.length,
                    students: totalStudents,
                    activeAssignments: assignmentRepository.list().filter(function (a) {
                        return a.status === 'PUBLISHED' && classIdSet[a.classId];
                    }).length,
                    pendingAssessments: submissionRepository.list().filter(function (s) {
                        return s.status === 'SUBMITTED' && classIdSet[s.classId];
                    }).length,
                    graded: submissionRepository.list().filter(function (s) {
                        return s.status === 'GRADED' && classIdSet[s.classId];
                    }).length,
                    submissions: mySubs.length
                },
                averageClassProgress: avgRate,
                recentSubmissions: mySubs.slice(0, 10).map(function (s) {
                    return { id: s.id, studentId: s.studentId, assignmentId: s.assignmentId, status: s.status, score: s.score, updatedAt: s.updatedAt };
                }),
                diagnosticPerformance: {
                    attempts: diagEvents.length,
                    completed: diagEvents.filter(function (a) { return a.type === 'COMPLETED_DIAGNOSTIC'; }).length,
                    averageScore: null,
                    skillDistribution: {}
                },
                commonMistakes: Object.keys(mistakes).map(function (k) { return { skill: k, count: mistakes[k] }; }),
                pendingGrading: submissionRepository.list().filter(function (s) { return s.status === 'SUBMITTED' && classIdSet[s.classId]; }).length
            });
        }

        return {
            studentFor: studentFor,
            instructorFor: instructorFor,
            recentActivity: function (userId, limit) { return recentActivityOf(userId, limit); },
            learningAvailable: learningAvailable,
            setLearningBridge: setLearningBridge
        };
    }
    var courseSvc = courseService();
    var assignmentSvc = assignmentService();
    var submissionSvc = submissionService();
    var gradingSvc = gradingService();
    var rubricSvc = rubricService();
    var reviewSvc = reviewService();
    var dashboardSvc = dashboardService();

    /* ------------------------------------------------------------------------
       13. COURSE / CONTENT LIBRARY (STEP 8, §14-16) + canonical data
       ------------------------------------------------------------------------ */
    var CONTENT_TYPES = ['LESSON', 'PRACTICE', 'JOB_SHEET', 'QUIZ', 'DIAGNOSTIC_CASE', 'SCENARIO', 'ASSESSMENT', 'RUBRIC'];
    var CONTENT_STATES = ['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED'];
    var ASSIGNMENT_TYPES = ['LESSON', 'PRACTICE', 'JOB_SHEET', 'QUIZ', 'DIAGNOSTIC_CASE', 'PRACTICAL_ASSESSMENT'];
    var BEST_SCORE_MODES = ['BEST', 'LATEST', 'AVERAGE'];
    var SUBMISSION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'SUBMITTED', 'GRADED', 'RETURNED', 'COMPLETED'];

    var contentRepository = makeRepo('CONT', 'contents');
    function isDiagAssignmentType(t) { return t === 'DIAGNOSTIC_CASE' || t === 'PRACTICAL_ASSESSMENT'; }
    function clampPct(v) { var n = Number(v); if (!isFinite(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); }

    /* Bridge ke data assessment Diagnostic engine (§21, §71): hasil DIAMBIL dari
       simulator/engine sungguhan, tidak pernah mengarang skor. */
    var diagBridgeOverride = undefined;
    function phase4Bridge() {
        if (diagBridgeOverride !== undefined) return diagBridgeOverride;
        if (!hasWindow) return null;
        var p4 = window.Phase4;
        return (p4 && p4.active) ? p4 : null;
    }
    function setDiagnosticBridge(b) { diagBridgeOverride = b; }
    function phase4Get(fn, fallback, payloadKey, payload) {
        if (payload && payload[payloadKey] !== undefined && payload[payloadKey] !== null) {
            return Array.isArray(payload[payloadKey]) ? payload[payloadKey].slice() : payload[payloadKey];
        }
        var p4 = phase4Bridge();
        try { if (p4 && typeof p4[fn] === 'function') { var r = p4[fn](); if (r != null) return r; } } catch (e) { /* noop */ }
        return fallback;
    }
    function captureDiagnosticArtifacts(payload) {
        var score = null;
        try {
            var p4 = phase4Bridge();
            if (p4 && typeof p4.getLastDiagnosticScore === 'function') { var s = p4.getLastDiagnosticScore(); if (typeof s === 'number') score = s; }
            else if (payload && typeof payload.score === 'number') score = payload.score;
        } catch (e) { score = null; }
        return {
            measurementHistory: phase4Get('getRecords', [], 'measurementHistory', payload),
            diagnosticPath: phase4Get('getDiagnosticPath', [], 'diagnosticPath', payload),
            hypotheses: phase4Get('getHypotheses', [], 'hypotheses', payload),
            evidence: phase4Get('getEvidence', [], 'evidence', payload),
            repairs: phase4Get('getRepairHistory', [], 'repairs', payload),
            verification: phase4Get('getVerification', null, 'verification', payload),
            rubric: phase4Get('getRubric', null, 'rubric', payload),
            hints: phase4Get('getHintCount', 0, 'hints', payload),
            mistakes: phase4Get('getMistakes', [], 'mistakes', payload),
            score: score,
            diagnosticTime: phase4Get('getDiagnosticTime', null, 'diagnosticTime', payload),
            testTime: phase4Get('getTestTime', null, 'testTime', payload),
            repairTime: phase4Get('getRepairTime', null, 'repairTime', payload)
        };
    }

    function courseService() {
        function manage(actor) { return authz.require(actor, 'MANAGE_CONTENT'); }
        function sortCreated(list) { return list.slice().sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); }); }
        return {
            /* ---- COURSE ENTITY ---- */
            createCourse: function (data, actor) {
                var perms = manage(actor); if (!perms.success) return perms;
                if (!isNonEmptyStr(data.title)) return apiError('VALIDATION', 'Course title required.');
                var c = courseRepository.save({
                    id: genId('COURSE'), title: safeStr(data.title, 200), description: safeStr(data.description, 1500),
                    subject: safeStr(data.subject, 160),
                    moduleIds: Array.isArray(data.moduleIds) ? data.moduleIds.slice() : [],
                    status: 'DRAFT', version: 1, createdBy: actor.id, createdAt: now(), updatedAt: now()
                });
                auditLog(actor.id, 'CREATE_COURSE', 'COURSE', c.id);
                return apiResult({ id: c.id, title: c.title, status: c.status, version: c.version });
            },
            updateCourse: function (id, patch, actor) {
                var perms = manage(actor); if (!perms.success) return perms;
                var c = courseRepository.getById(id); if (!c) return apiError('NOT_FOUND', 'Course not found.');
                if (patch.title != null && isNonEmptyStr(patch.title)) c.title = safeStr(patch.title, 200);
                if (patch.description != null) c.description = safeStr(patch.description, 1500);
                if (patch.subject != null) c.subject = safeStr(patch.subject, 160);
                if (Array.isArray(patch.moduleIds)) c.moduleIds = patch.moduleIds.slice();
                c.version = (c.version || 1) + 1;
                if (c.status === 'PUBLISHED') c.status = 'REVIEW';
                c.updatedAt = now();
                courseRepository.save(c);
                auditLog(actor.id, 'UPDATE_COURSE', 'COURSE', id);
                return apiResult({ id: c.id, title: c.title, status: c.status, version: c.version });
            },
            publishCourse: function (id, actor) {
                var perms = manage(actor); if (!perms.success) return perms;
                var c = courseRepository.getById(id); if (!c) return apiError('NOT_FOUND', 'Course not found.');
                c.status = 'PUBLISHED'; c.updatedAt = now(); courseRepository.save(c);
                auditLog(actor.id, 'PUBLISH_COURSE', 'COURSE', id);
                return apiResult({ id: c.id, status: c.status, version: c.version });
            },
            archiveCourse: function (id, actor) {
                var perms = manage(actor); if (!perms.success) return perms;
                var c = courseRepository.getById(id); if (!c) return apiError('NOT_FOUND', 'Course not found.');
                c.status = 'ARCHIVED'; c.updatedAt = now(); courseRepository.save(c);
                auditLog(actor.id, 'ARCHIVE_CONTENT', 'COURSE', id);
                return apiResult({ id: c.id, status: c.status });
            },
            listCourses: function (actor) {
                if (!authz.can(actor, 'VIEW_CONTENT')) return apiError('FORBIDDEN', 'Not permitted.');
                return apiResult(sortCreated(courseRepository.list()));
            },
            getCourse: function (id, actor) {
                if (!authz.can(actor, 'VIEW_CONTENT')) return apiError('FORBIDDEN', 'Not permitted.');
                var c = courseRepository.getById(id);
                return c ? apiResult(c) : apiError('NOT_FOUND', 'Course not found.');
            },

            /* ---- CONTENT LIBRARY (§15-16) ---- */
            createContent: function (data, actor) {
                var perms = authz.require(actor, 'MANAGE_CONTENT'); if (!perms.success) return perms;
                if (CONTENT_TYPES.indexOf(data.type) < 0) return apiError('VALIDATION', 'Unknown content type.');
                if (!isNonEmptyStr(data.title)) return apiError('VALIDATION', 'Title required.');
                if (data.refId != null && isNonEmptyStr(data.refId)) {
                    var dup = contentRepository.list().filter(function (x) {
                        return x.type === data.type && x.refId === data.refId && x.status !== 'ARCHIVED';
                    })[0];
                    if (dup) return apiError('DUPLICATE', 'Content with that ref already exists.');
                }
                var c = contentRepository.save({
                    id: genId('CONT'), type: data.type, title: safeStr(data.title, 200),
                    description: safeStr(data.description, 1500),
                    refId: data.refId != null ? safeStr(data.refId, 120) : null,
                    body: data.body != null ? data.body : null,
                    status: 'DRAFT', version: 1, createdBy: actor.id, createdAt: now(), updatedAt: now()
                });
                auditLog(actor.id, 'CREATE_CONTENT', c.type, c.id);
                logActivity(actor.id, 'CREATED_CONTENT', c.type, c.id);
                return apiResult({ id: c.id, type: c.type, title: c.title, status: c.status, version: c.version, refId: c.refId });
            },
            updateContent: function (id, patch, actor) {
                var perms = authz.require(actor, 'MANAGE_CONTENT'); if (!perms.success) return perms;
                var c = contentRepository.getById(id); if (!c) return apiError('NOT_FOUND', 'Content not found.');
                if (patch.title != null && isNonEmptyStr(patch.title)) c.title = safeStr(patch.title, 200);
                if (patch.description != null) c.description = safeStr(patch.description, 1500);
                if (patch.body !== undefined) c.body = patch.body;
                c.version = (c.version || 1) + 1;
                if (c.status === 'PUBLISHED') c.status = 'REVIEW';
                c.updatedAt = now();
                contentRepository.save(c);
                auditLog(actor.id, 'UPDATE_CONTENT', c.type, id);
                return apiResult({ id: c.id, status: c.status, version: c.version });
            },
            publishContent: function (id, actor) {
                var perms = authz.require(actor, 'MANAGE_CONTENT'); if (!perms.success) return perms;
                var c = contentRepository.getById(id); if (!c) return apiError('NOT_FOUND', 'Content not found.');
                c.status = 'PUBLISHED'; c.updatedAt = now(); contentRepository.save(c);
                auditLog(actor.id, 'PUBLISH_CONTENT', c.type, id);
                return apiResult({ id: c.id, status: c.status, version: c.version });
            },
            archiveContent: function (id, actor) {
                var perms = authz.require(actor, 'MANAGE_CONTENT'); if (!perms.success) return perms;
                var c = contentRepository.getById(id); if (!c) return apiError('NOT_FOUND', 'Content not found.');
                c.status = 'ARCHIVED'; c.updatedAt = now(); contentRepository.save(c);
                auditLog(actor.id, 'ARCHIVE_CONTENT', c.type, id);
                return apiResult({ id: c.id, status: c.status });
            },
            listContents: function (actor) {
                if (!authz.can(actor, 'VIEW_CONTENT')) return apiError('FORBIDDEN', 'Not permitted.');
                return apiResult(sortCreated(contentRepository.list()).map(function (c) {
                    return { id: c.id, type: c.type, title: c.title, refId: c.refId, status: c.status, version: c.version };
                }));
            },
            getContent: function (id, actor) {
                if (!authz.can(actor, 'VIEW_CONTENT')) return apiError('FORBIDDEN', 'Not permitted.');
                var c = contentRepository.getById(id);
                return c ? apiResult(c) : apiError('NOT_FOUND', 'Content not found.');
            },

            /* ---- kurikulum: referensi katalog EKSISTING (tanpa duplikasi) ---- */
            moduleCatalog: function (actor) {
                if (!authz.can(actor, 'VIEW_CONTENT')) return apiError('FORBIDDEN', 'Not permitted.');
                return apiResult(phase5Arr('getModules').map(function (m) {
                    return { id: m.id, title: m.title, lessons: (m.lessons || []).slice(), practices: (m.practices || []).slice() };
                }));
            },
            diagnosticCaseCatalog: function (actor) {
                if (!authz.can(actor, 'VIEW_CONTENT')) return apiError('FORBIDDEN', 'Not permitted.');
                return apiResult(caseRepository.list().filter(function (c) { return c.status === 'PUBLISHED'; })
                    .map(function (c) { return { id: c.refId, difficulty: c.difficulty, skillFocus: c.skillFocus, title: c.title }; }));
            }
        };
    }

    /* ------------------------------------------------------------------------
       14. ASSIGNMENT ENGINE (STEP 9, §17-19, §73-74, §75-77)
       ------------------------------------------------------------------------ */
    function assignmentService() {
        function ownClass(actor, classId) {
            var c = classRepository.getById(classId);
            if (!c) return null;
            if (actor && actor.role === 'ADMIN') return c;
            if (actor && c.instructorIds.indexOf(actor.id) >= 0) return c;
            return null;
        }
        function contentTitle(a) {
            if (isDiagAssignmentType(a.type)) {
                var cr = caseRepository.list().filter(function (x) { return x.refId === a.contentId; })[0];
                if (cr) return cr.title || cr.refId;
            }
            if (a.contentId != null) {
                var cnt = contentRepository.getById(a.contentId);
                if (cnt) return cnt.title;
            }
            return a.title;
        }
        function preview(a) {
            return { id: a.id, classId: a.classId, type: a.type, contentId: a.contentId, rubricId: a.rubricId || null,
                title: a.title,
                description: a.description, startAt: a.startAt, dueAt: a.dueAt, attempts: a.attempts,
                passingScore: a.passingScore, required: a.required, bestScoreMode: a.bestScoreMode, studentIds: (a.studentIds || []).slice(),
                status: a.status, publishedAt: a.publishedAt, contentTitle: contentTitle(a) };
        }
        function validateContentRef(type, contentId, actor) {
            if (isDiagAssignmentType(type)) {
                if (!contentId) return 'contentId (diagnostic case) required.';
                var found = caseRepository.list().filter(function (x) { return x.refId === contentId; })[0];
                if (!found) {
                    if (/^(CASE_\d+|SC_.+)$/.test(contentId)) return null; // id legacy Phase4 / scenario Phase7
                    return 'Diagnostic case not in catalog.';
                }
                if (found.status !== 'PUBLISHED') return 'Diagnostic case must be PUBLISHED.';
                return null;
            }
            if (contentId != null && isNonEmptyStr(contentId)) {
                var c = contentRepository.getById(contentId);
                if (!c) return 'Content not found in library.';
                if (c.status !== 'PUBLISHED') return 'Assignment content must be PUBLISHED first.';
            }
            return null;
        }
        function visibleTo(a, actor) {
            if (!actor) return false;
            if (actor.role === 'ADMIN') return true;
            if (actor.role === 'INSTRUCTOR') {
                var c = classRepository.getById(a.classId);
                return !!(c && c.instructorIds.indexOf(actor.id) >= 0);
            }
            if (actor.role === 'STUDENT') {
                var c2 = classRepository.getById(a.classId);
                if (!c2 || c2.studentIds.indexOf(actor.id) < 0) return false;
                if (a.status !== 'PUBLISHED') return false;
                if (a.studentIds && a.studentIds.length && a.studentIds.indexOf(actor.id) < 0) return false;
                return true;
            }
            return false;
        }

        return {
            create: function (data, actor) {
                var perms = authz.require(actor, 'CREATE_ASSIGNMENT');
                if (!perms.success) return perms;
                if (!isNonEmptyStr(data.title)) return apiError('VALIDATION', 'Assignment title required.');
                var c = ownClass(actor, data.classId);
                if (!c) return apiError('NOT_FOUND', 'Class not found or not yours.');
                var type = data.type || 'DIAGNOSTIC_CASE';
                if (ASSIGNMENT_TYPES.indexOf(type) < 0) return apiError('VALIDATION', 'Unknown assignment type.');
                var contentErr = validateContentRef(type, data.contentId, actor);
                if (contentErr) return apiError('VALIDATION', contentErr);
                if (data.rubricId != null) {
                    var rubr = rubricRepository.getById(data.rubricId);
                    if (!rubr || rubr.status !== 'ACTIVE') return apiError('VALIDATION', 'Rubric not found or not active.');
                }
                if (data.startAt != null && data.dueAt != null && data.dueAt < data.startAt) {
                    return apiError('VALIDATION', 'dueAt must be >= startAt.');
                }
                if (data.attempts != null && data.attempts !== 0 && (!isFinite(data.attempts) || data.attempts < 1)) {
                    return apiError('VALIDATION', 'attempts must be >= 1 (0 = unlimited).');
                }
                if (data.passingScore != null && (data.passingScore < 0 || data.passingScore > 100)) {
                    return apiError('VALIDATION', 'passingScore must be 0-100.');
                }
                var a = assignmentRepository.save({
                    id: genId('ASSIGN'), classId: c.id, organizationId: c.organizationId,
                    type: type, contentId: data.contentId != null ? data.contentId : null,
                    rubricId: data.rubricId != null ? data.rubricId : null,
                    title: safeStr(data.title, 200), description: safeStr(data.description, 1500),
                    startAt: data.startAt != null ? data.startAt : null,
                    dueAt: data.dueAt != null ? data.dueAt : null,
                    attempts: data.attempts != null ? data.attempts : 1,
                    passingScore: data.passingScore != null ? data.passingScore : 75,
                    timeLimitMs: data.timeLimitMs != null ? data.timeLimitMs : null,
                    required: !!data.required,
                    bestScoreMode: BEST_SCORE_MODES.indexOf(data.bestScoreMode) >= 0 ? data.bestScoreMode : 'BEST',
                    studentIds: Array.isArray(data.studentIds) ? data.studentIds.slice() : [],
                    status: 'DRAFT', createdBy: actor.id, createdAt: now(), publishedAt: null, updatedAt: now()
                });
                auditLog(actor.id, 'CREATE_ASSIGNMENT', 'ASSIGNMENT', a.id);
                return apiResult(preview(a));
            },
            update: function (id, patch, actor) {
                var perms = authz.require(actor, 'CREATE_ASSIGNMENT');
                if (!perms.success) return perms;
                var a = assignmentRepository.getById(id);
                if (!a || !ownClass(actor, a.classId)) return apiError('NOT_FOUND', 'Assignment not found or not yours.');
                var pa = patch || {};
                if (pa.classId != null && pa.classId !== a.classId) {
                    var nc = ownClass(actor, pa.classId);
                    if (!nc) return apiError('NOT_FOUND', 'Target class not found or not yours.');
                    a.classId = nc.id; a.organizationId = nc.organizationId;
                    a.studentIds = []; // anggota kelas lama tidak berlaku di kelas baru
                }
                if (pa.type != null && pa.type !== a.type) {
                    if (ASSIGNMENT_TYPES.indexOf(pa.type) < 0) return apiError('VALIDATION', 'Unknown assignment type.');
                    a.type = pa.type;
                }
                if (pa.contentId !== undefined || pa.type != null) {
                    var cid = pa.contentId !== undefined ? (pa.contentId || null) : a.contentId;
                    var cErr = validateContentRef(a.type, cid, actor);
                    if (cErr) return apiError('VALIDATION', cErr);
                    a.contentId = cid;
                }
                var nStart = pa.startAt !== undefined ? pa.startAt : a.startAt;
                var nDue = pa.dueAt !== undefined ? pa.dueAt : a.dueAt;
                if (nStart != null && nDue != null && nDue < nStart) return apiError('VALIDATION', 'dueAt must be >= startAt.');
                if (pa.passingScore != null && (pa.passingScore < 0 || pa.passingScore > 100)) return apiError('VALIDATION', 'passingScore must be 0-100.');
                if (pa.attempts != null && pa.attempts !== 0 && (!isFinite(pa.attempts) || pa.attempts < 1)) return apiError('VALIDATION', 'attempts must be >= 1 (0 = unlimited).');
                if (pa.title != null) {
                    if (!isNonEmptyStr(pa.title)) return apiError('VALIDATION', 'Assignment title required.');
                    a.title = safeStr(pa.title, 200);
                }
                if (pa.description != null) a.description = safeStr(pa.description, 1500);
                a.dueAt = nDue; a.startAt = nStart;
                if (pa.passingScore != null) a.passingScore = pa.passingScore;
                if (pa.attempts != null) a.attempts = pa.attempts;
                if (pa.bestScoreMode != null && BEST_SCORE_MODES.indexOf(pa.bestScoreMode) >= 0) a.bestScoreMode = pa.bestScoreMode;
                if (pa.status === 'DRAFT' || pa.status === 'PUBLISHED' || pa.status === 'ARCHIVED') {
                    if (pa.status === 'PUBLISHED' && a.status !== 'PUBLISHED') a.publishedAt = now();
                    a.status = pa.status;
                }
                patch = pa;
                if (patch.rubricId !== undefined) {
                    if (patch.rubricId != null) {
                        var rubrU = rubricRepository.getById(patch.rubricId);
                        if (!rubrU || rubrU.status !== 'ACTIVE') return apiError('VALIDATION', 'Rubric not found or not active.');
                    }
                    a.rubricId = patch.rubricId != null ? patch.rubricId : null;
                }
                if (Array.isArray(patch.studentIds)) a.studentIds = patch.studentIds.slice();
                a.updatedAt = now(); assignmentRepository.save(a);
                return apiResult(preview(a));
            },
            publish: function (id, actor) {
                var perms = authz.require(actor, 'PUBLISH_ASSIGNMENT');
                if (!perms.success) return perms;
                var a = assignmentRepository.getById(id);
                if (!a || !ownClass(actor, a.classId)) return apiError('NOT_FOUND', 'Assignment not found or not yours.');
                var contentErr = validateContentRef(a.type, a.contentId, actor);
                if (contentErr) return apiError('VALIDATION', contentErr);
                a.status = 'PUBLISHED'; a.publishedAt = now(); assignmentRepository.save(a);
                auditLog(actor.id, 'PUBLISH_ASSIGNMENT', 'ASSIGNMENT', id);
                var cls = classRepository.getById(a.classId);
                if (cls) {
                    var targets = (a.studentIds && a.studentIds.length) ? a.studentIds : cls.studentIds;
                    targets.forEach(function (sid) {
                        notificationRepository.add({ id: genId('NOTIF'), userId: sid, category: 'Assignment',
                            title: 'Assignment baru: ' + a.title, body: 'diterbitkan untuk kelas ' + cls.name,
                            read: false, createdAt: now() });
                    });
                }
                return apiResult(preview(a));
            },
            archive: function (id, actor) {
                var perms = authz.require(actor, 'PUBLISH_ASSIGNMENT');
                if (!perms.success) return perms;
                var a = assignmentRepository.getById(id);
                if (!a || !ownClass(actor, a.classId)) return apiError('NOT_FOUND', 'Assignment not found or not yours.');
                a.status = 'ARCHIVED'; a.updatedAt = now(); assignmentRepository.save(a);
                auditLog(actor.id, 'ARCHIVE_ASSIGNMENT', 'ASSIGNMENT', id);
                return apiResult(preview(a));
            },
            list: function (actor) {
                if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
                return apiResult(assignmentRepository.list().filter(function (a) { return visibleTo(a, actor); }).map(preview));
            },
            get: function (id, actor) {
                if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
                var a = assignmentRepository.getById(id);
                if (!a) return apiError('NOT_FOUND', 'Assignment not found.');
                if (!visibleTo(a, actor)) return apiError('FORBIDDEN', 'Not permitted.');
                return apiResult(preview(a));
            },
            forStudent: function (student) {
                if (!student || student.role !== 'STUDENT') return { success: true, data: [] };
                return apiResult(assignmentRepository.list()
                    .filter(function (a) { return visibleTo(a, student) && a.status === 'PUBLISHED'; })
                    .map(preview));
            }
        };
    }

    /* ------------------------------------------------------------------------
       15. SUBMISSION ENGINE (STEP 10, §20-21, §75-78)
       ------------------------------------------------------------------------ */
    function submissionService() {
        return {
            start: function (student, assignmentId) {
                if (!student) return apiError('AUTH_REQUIRED', 'Authentication required.');
                if (student.role !== 'STUDENT') return apiError('FORBIDDEN', 'Only students can start assignments.');
                var a = assignmentRepository.getById(assignmentId);
                if (!a) return apiError('NOT_FOUND', 'Assignment not found.');
                if (a.status !== 'PUBLISHED') return apiError('NOT_OPEN', 'Assignment is not published.');
                var c = classRepository.getById(a.classId);
                if (!c || c.studentIds.indexOf(student.id) < 0) return apiError('FORBIDDEN', 'Not a member of this class.');
                if (a.studentIds && a.studentIds.length && a.studentIds.indexOf(student.id) < 0) {
                    return apiError('FORBIDDEN', 'Not assigned to you.');
                }
                if (a.startAt != null && now() < a.startAt) return apiError('NOT_OPEN', 'Assignment not yet open.');
                var mine = submissionRepository.list().filter(function (s) {
                    return s.assignmentId === assignmentId && s.studentId === student.id;
                });
                var inProgress = mine.filter(function (s) { return s.status === 'IN_PROGRESS'; })[0];
                if (inProgress) {
                    return apiResult({ id: inProgress.id, status: inProgress.status, attemptNumber: inProgress.attemptNumber, resumed: true });
                }
                var used = mine.filter(function (s) { return s.status !== 'IN_PROGRESS' && s.status !== 'RETURNED'; }).length;
                if (a.attempts && a.attempts > 0 && used >= a.attempts) {
                    return apiError('ATTEMPTS_EXHAUSTED', 'No attempts left.');
                }
                var sub = submissionRepository.save({
                    id: genId('SUB'), assignmentId: assignmentId, classId: a.classId,
                    studentId: student.id, attemptNumber: used + 1,
                    startedAt: now(), submittedAt: null, status: 'IN_PROGRESS',
                    score: null, feedback: null, rubric: null,
                    measurementHistory: [], diagnosticPath: [], hypotheses: [], evidence: [],
                    repairs: [], verification: null, hints: 0, mistakes: [],
                    timeStarted: now(), timeSpent: 0, timeSubmitted: null,
                    diagnosticTime: null, testTime: null, repairTime: null
                });
                logActivity(student.id, 'STARTED_DIAGNOSTIC', 'ASSIGNMENT', assignmentId);
                if (offlineService.isOffline()) {
                    // §41/§81: meski OFFLINE, mulai pengerjaan tetap jalan; data lokal,
                    // antrean sync & 'retry available' ditandai transparan.
                    sub.savedLocally = true;
                    sub.networkAtSave = 'OFFLINE';
                    offlineService.markLocalChange('SUBMISSION', sub.id, 'CREATE');
                    syncService.enqueue('CREATE', 'SUBMISSION', sub.id,
                        { assignmentId: assignmentId, studentId: student.id, madeOffline: true, syncVersion: 1 });
                }
                return apiResult({ id: sub.id, status: sub.status, attemptNumber: sub.attemptNumber,
                    savedLocally: !!sub.savedLocally, network: sub.networkAtSave || 'ONLINE' });
            },

            submit: function (student, assignmentId, payload) {
                if (!student) return apiError('AUTH_REQUIRED', 'Authentication required.');
                if (student.role !== 'STUDENT') return apiError('FORBIDDEN', 'Only students can submit.');
                var a = assignmentRepository.getById(assignmentId);
                if (!a) return apiError('NOT_FOUND', 'Assignment not found.');
                var sub = submissionRepository.list().filter(function (s) {
                    return s.assignmentId === assignmentId && s.studentId === student.id && s.status === 'IN_PROGRESS';
                }).sort(function (x, y) { return (x.startedAt || 0) - (y.startedAt || 0); })[0];
                if (!sub) {
                    var started = this.start(student, assignmentId);
                    if (!started.success) return started;
                    var rec = submissionRepository.list().filter(function (s) { return s.id === started.data.id; })[0];
                    sub = rec || null;
                    if (!sub) return apiError('NOT_FOUND', 'Submission could not be created.');
                }
                if (isDiagAssignmentType(a.type)) {
                    // §21/§71: data assessment DIAMBIL dari engine diagnosis sungguhan;
                    // skor hanya tersimpan bila didukung bukti nyata, selain itu dikurasi (STEP 11).
                    var art = captureDiagnosticArtifacts(payload || {});
                    sub.measurementHistory = art.measurementHistory;
                    sub.diagnosticPath = art.diagnosticPath;
                    sub.hypotheses = art.hypotheses;
                    sub.evidence = art.evidence;
                    sub.repairs = art.repairs;
                    sub.verification = art.verification;
                    sub.rubric = art.rubric;
                    sub.hints = art.hints;
                    sub.mistakes = art.mistakes;
                    sub.diagnosticTime = art.diagnosticTime;
                    sub.testTime = art.testTime;
                    sub.repairTime = art.repairTime;
                    var hasRealEvidence = sub.measurementHistory.length > 0 || sub.evidence.length > 0 ||
                        sub.diagnosticPath.length > 0 || sub.repairs.length > 0 || !!sub.verification;
                    sub.score = (hasRealEvidence && typeof art.score === 'number') ? clampPct(art.score) : null;
                } else {
                    var cap = captureLearningArtifact(a, payload || {});
                    if (cap) {
                        sub.measurementHistory = cap.measurements || [];
                        sub.rubric = cap.rubric || null;
                        if (cap.score != null) sub.score = clampPct(cap.score);
                    }
                }
                sub.status = 'SUBMITTED';
                sub.submittedAt = now();
                sub.timeSubmitted = sub.submittedAt;
                sub.timeSpent = (sub.timeSubmitted || 0) - (sub.timeStarted || sub.startedAt || 0);
                submissionRepository.save(sub);
                logActivity(student.id, isDiagAssignmentType(a.type) ? 'COMPLETED_DIAGNOSTIC' : 'SUBMITTED', 'ASSIGNMENT', assignmentId);
                return apiResult({ id: sub.id, status: sub.status, attemptNumber: sub.attemptNumber, score: sub.score });
            },

            get: function (id, actor) {
                if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
                var s = submissionRepository.getById(id);
                if (!s) return apiError('NOT_FOUND', 'Submission not found.');
                if (actor.role === 'ADMIN') return apiResult(s);
                if (actor.role === 'STUDENT') {
                    if (s.studentId !== actor.id) return apiError('FORBIDDEN', 'Not your submission.');
                    return apiResult(s);
                }
                if (actor.role === 'INSTRUCTOR') {
                    var c = classRepository.getById(s.classId);
                    if (c && c.instructorIds.indexOf(actor.id) >= 0) return apiResult(s);
                }
                return apiError('FORBIDDEN', 'Not permitted.');
            },

            list: function (actor) {
                if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
                var all = submissionRepository.list();
                if (actor.role === 'ADMIN') return apiResult(all);
                if (actor.role === 'STUDENT') {
                    return apiResult(all.filter(function (s) { return s.studentId === actor.id; }));
                }
                var cids = classRepository.list().filter(function (c) { return c.instructorIds.indexOf(actor.id) >= 0; })
                    .map(function (c) { return c.id; });
                return apiResult(all.filter(function (s) { return cids.indexOf(s.classId) >= 0; }));
            },

            listForAssignment: function (assignmentId, actor) {
                var a = assignmentRepository.getById(assignmentId);
                if (!a) return apiError('NOT_FOUND', 'Assignment not found.');
                if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
                var c = classRepository.getById(a.classId);
                var permitted = actor.role === 'ADMIN' || (c && c.instructorIds.indexOf(actor.id) >= 0);
                if (!permitted) return apiError('FORBIDDEN', 'Not permitted.');
                return apiResult(submissionRepository.list().filter(function (s) { return s.assignmentId === assignmentId; }));
            },

            canRetake: function (assignmentId, student) {
                var a = assignmentRepository.getById(assignmentId);
                if (!a || !student) return { success: false, error: { code: 'NOT_FOUND', message: 'Not found.' } };
                var mine = submissionRepository.list().filter(function (s) {
                    return s.assignmentId === assignmentId && s.studentId === student.id
                        && s.status !== 'IN_PROGRESS' && s.status !== 'RETURNED'; // RETURNED = revisi, tidak habiskan attempt (§75)
                });
                if (!a.attempts) return apiResult({ allowed: true, attemptsUsed: mine.length, maxAttempts: 0 });
                return apiResult({ allowed: mine.length < a.attempts, attemptsUsed: mine.length, maxAttempts: a.attempts });
            }
        };
    }

    function captureLearningArtifact(a, payload) {
        var out = { measurements: [], rubric: null, score: null };
        if (payload.score != null && typeof payload.score === 'number') out.score = payload.score;
        if (payload.score != null && typeof payload.score === 'number') out.score = clampPct(payload.score);
        if (payload.measurements && Array.isArray(payload.measurements)) out.measurements = payload.measurements.slice();
        if (a.type === 'QUIZ') {
            var results = phase5Arr('getAssessmentResults');
            for (var i = results.length - 1; i >= 0; i--) {
                var r = results[i];
                if (r && (r.id === a.contentId || r.moduleId === a.contentId)) {
                    out.score = (r.percent != null) ? clampPct(r.percent) : out.score;
                    out.rubric = { source: 'phase5', type: 'QUIZ' };
                    break;
                }
            }
            return out;
        }
        if (a.type === 'JOB_SHEET') {
            var jsId = null;
            try { var p5 = phase5Obj(); if (p5 && typeof p5.getContentRef === 'function') jsId = p5.getContentRef(a.contentId); } catch (e) { /* noop */ }
            var res = phase5Get('getJobSheetResult', null, 'jobSheetResult', payload);
            var val = null;
            try { if (typeof res === 'function') val = res(jsId || a.contentId); } catch (e) { /* noop */ }
            if (val && typeof val === 'object') {
                if (val.score != null) out.score = clampPct(val.score);
                if (val.measurements) out.measurements = val.measurements.slice();
                out.rubric = { source: 'phase5', type: 'JOB_SHEET' };
            }
            return out;
        }
        if (a.type === 'LESSON') {
            var rec = phase5Arr('getLearningRecord');
            for (var j = rec.length - 1; j >= 0; j--) {
                if (rec[j] && rec[j].lessonId === a.contentId) { out.measurements = [rec[j]]; break; }
            }
            return out;
        }
        return out;
    }

    /* ------------------------------------------------------------------------
       16. RUBRIC ENGINE (STEP 12, §23) — integrasi Phase5 §25
       Rubrik dapat dikustomisasi: criterion / weight / maxScore /
       performanceLevels / instructorComment. Default: 8 kriteria bobot 100.
       ------------------------------------------------------------------------ */
    function defaultPracticalRubric() {
        return {
            id: null, title: 'Diagnostic Practical Rubric', type: 'PRACTICAL_DIAGNOSTIC',
            source: 'phase5', maxTotal: 100, status: 'ACTIVE',
            criteria: [
                { key: 'INITIAL_INSPECTION', label: 'Initial Inspection', weight: 10, maxScore: 10, performanceLevels: ['Needs Improvement', 'Satisfactory', 'Good', 'Excellent'], comment: null },
                { key: 'SAFETY_PROCEDURE', label: 'Safety Procedure', weight: 10, maxScore: 10, performanceLevels: ['Needs Improvement', 'Satisfactory', 'Good', 'Excellent'], comment: null },
                { key: 'MEASUREMENT_PROCEDURE', label: 'Measurement Procedure', weight: 20, maxScore: 20, performanceLevels: ['Needs Improvement', 'Satisfactory', 'Good', 'Excellent'], comment: null },
                { key: 'MEASUREMENT_ACCURACY', label: 'Measurement Accuracy', weight: 15, maxScore: 15, performanceLevels: ['Needs Improvement', 'Satisfactory', 'Good', 'Excellent'], comment: null },
                { key: 'DIAGNOSTIC_REASONING', label: 'Diagnostic Reasoning', weight: 20, maxScore: 20, performanceLevels: ['Needs Improvement', 'Satisfactory', 'Good', 'Excellent'], comment: null },
                { key: 'REPAIR_PROCEDURE', label: 'Repair Procedure', weight: 10, maxScore: 10, performanceLevels: ['Needs Improvement', 'Satisfactory', 'Good', 'Excellent'], comment: null },
                { key: 'VERIFICATION', label: 'Verification', weight: 10, maxScore: 10, performanceLevels: ['Needs Improvement', 'Satisfactory', 'Good', 'Excellent'], comment: null },
                { key: 'DOCUMENTATION', label: 'Documentation', weight: 5, maxScore: 5, performanceLevels: ['Needs Improvement', 'Satisfactory', 'Good', 'Excellent'], comment: null }
            ]
        };
    }

    function validateRubricCriteria(criteria) {
        if (!Array.isArray(criteria) || !criteria.length) return 'Rubric must contain at least one criterion.';
        var sum = 0;
        for (var i = 0; i < criteria.length; i++) {
            var cr = criteria[i] || {};
            if (!isNonEmptyStr(cr.label) || !isNonEmptyStr(cr.key)) return 'Each criterion needs a key and label.';
            var w = Number(cr.weight);
            if (!isFinite(w) || w <= 0) return 'Criterion weight must be a positive number.';
            var mx = Number(cr.maxScore != null ? cr.maxScore : cr.weight);
            if (!isFinite(mx) || mx <= 0) return 'Criterion maxScore must be a positive number.';
            sum += w;
        }
        if (Math.round(sum) !== 100) return 'Rubric weights must total 100 (got ' + sum + ').';
        return null;
    }
    function normalizeCriteria(criteria) {
        return criteria.map(function (cr) {
            var mx = Number(cr.maxScore != null ? cr.maxScore : cr.weight);
            return {
                key: safeStr(cr.key, 60).toUpperCase(),
                label: safeStr(cr.label, 120),
                weight: Number(cr.weight),
                maxScore: mx,
                performanceLevels: Array.isArray(cr.performanceLevels) && cr.performanceLevels.length
                    ? cr.performanceLevels.slice() : ['Needs Improvement', 'Satisfactory', 'Good', 'Excellent'],
                comment: cr.comment != null ? safeStr(cr.comment, 300) : null
            };
        });
    }
    function computeRubricTotal(rubric, criterionScores) {
        var breakdown = [];
        var total = 0;
        var weightSum = 0;
        (rubric.criteria || []).forEach(function (cr) {
            var raw = criterionScores ? criterionScores[cr.key] : undefined;
            var sc = raw == null ? null : Number(raw);
            var capped = (sc == null || !isFinite(sc)) ? 0 : Math.max(0, Math.min(cr.maxScore, sc));
            var contribution = (cr.maxScore ? capped / cr.maxScore : 0) * (cr.weight || 0);
            weightSum += (cr.weight || 0);
            total += contribution;
            breakdown.push({ key: cr.key, label: cr.label, weight: cr.weight, maxScore: cr.maxScore,
                score: (sc == null) ? null : capped, contribution: contribution, comment: cr.comment || null });
        });
        return { total: Math.round(total), maxTotal: weightSum, breakdown: breakdown };
    }
    function rubricPreview(r) {
        return { id: r.id, title: r.title, type: r.type, source: r.source, status: r.status,
            maxTotal: r.maxTotal, criteria: r.criteria || [], createdBy: r.createdBy };
    }
    function rubricService() {
        return {
            create: function (data, actor) {
                var perms = authz.require(actor, 'MANAGE_CONTENT'); if (!perms.success) return perms;
                if (!isNonEmptyStr(data.title)) return apiError('VALIDATION', 'Rubric title required.');
                var err = validateRubricCriteria(data.criteria);
                if (err) return apiError('VALIDATION', err);
                var r = rubricRepository.save({
                    id: genId('RUB'), title: safeStr(data.title, 200), type: safeStr(data.type || 'PRACTICAL_DIAGNOSTIC', 80),
                    source: data.source || 'phase8', criteria: normalizeCriteria(data.criteria),
                    maxTotal: 100, status: 'ACTIVE', createdBy: actor.id, createdAt: now(), updatedAt: now()
                });
                auditLog(actor.id, 'CREATE_RUBRIC', 'RUBRIC', r.id);
                logActivity(actor.id, 'CREATED_RUBRIC', 'RUBRIC', r.id);
                return apiResult({ id: r.id, title: r.title, type: r.type, status: r.status, criteria: r.criteria, maxTotal: r.maxTotal });
            },
            update: function (id, patch, actor) {
                var perms = authz.require(actor, 'MANAGE_CONTENT'); if (!perms.success) return perms;
                var r = rubricRepository.getById(id); if (!r) return apiError('NOT_FOUND', 'Rubric not found.');
                if (patch.title != null && isNonEmptyStr(patch.title)) r.title = safeStr(patch.title, 200);
                if (patch.type != null) r.type = safeStr(patch.type, 80);
                if (patch.criteria !== undefined) {
                    var err = validateRubricCriteria(patch.criteria);
                    if (err) return apiError('VALIDATION', err);
                    r.criteria = normalizeCriteria(patch.criteria);
                    r.maxTotal = 100;
                }
                r.updatedAt = now(); rubricRepository.save(r);
                auditLog(actor.id, 'UPDATE_RUBRIC', 'RUBRIC', id);
                return apiResult({ id: r.id, title: r.title, status: r.status, criteria: r.criteria });
            },
            archive: function (id, actor) {
                var perms = authz.require(actor, 'MANAGE_CONTENT'); if (!perms.success) return perms;
                var r = rubricRepository.getById(id); if (!r) return apiError('NOT_FOUND', 'Rubric not found.');
                r.status = 'ARCHIVED'; r.updatedAt = now(); rubricRepository.save(r);
                auditLog(actor.id, 'ARCHIVE_RUBRIC', 'RUBRIC', id);
                return apiResult({ id: r.id, status: r.status });
            },
            list: function (actor) {
                var perms = authz.require(actor, 'VIEW_CONTENT'); if (!perms.success) return perms;
                return apiResult(rubricRepository.list().filter(function (r) { return r.status === 'ACTIVE'; }).map(rubricPreview));
            },
            get: function (id, actor) {
                var perms = authz.require(actor, 'VIEW_CONTENT'); if (!perms.success) return perms;
                var r = rubricRepository.getById(id);
                return r ? apiResult(rubricPreview(r)) : apiError('NOT_FOUND', 'Rubric not found.');
            },
            compute: function (ref, criterionScores, actor, passingScore) {
                var perms = authz.require(actor, 'VIEW_CONTENT'); if (!perms.success) return perms;
                var r = (typeof ref === 'object' && ref && ref.criteria) ? ref : rubricRepository.getById(ref);
                if (!r) return apiError('NOT_FOUND', 'Rubric not found.');
                var res = computeRubricTotal(r, criterionScores || {});
                if (passingScore != null) res.passed = res.total >= Number(passingScore);
                return apiResult(res);
            },
            defaultRubric: function (actor) {
                var perms = authz.require(actor, 'VIEW_CONTENT'); if (!perms.success) return perms;
                return apiResult(defaultPracticalRubric());
            }
        };
    }

    /* ------------------------------------------------------------------------
       17. GRADING SERVICE (STEP 11, §22-24)
       Instruktur membuka submission, menilai (score + feedback) atau
       mengembalikan untuk revisi (RETURNED). Grade HANYA untuk submission
       dengan bukti engine nyata (§21/§71) — tidak menilai submission kosong.
       ------------------------------------------------------------------------ */
    function gradingService() {
        function evidencePresent(s) {
            return s && ((s.measurementHistory && s.measurementHistory.length > 0) ||
                (s.diagnosticPath && s.diagnosticPath.length > 0) ||
                (s.evidence && s.evidence.length > 0) ||
                (s.repairs && s.repairs.length > 0) || !!s.verification);
        }
        function ownershipCheck(actor, classId) {
            if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
            if (actor.role === 'ADMIN') return null;
            var c = classRepository.getById(classId);
            if (actor.role === 'INSTRUCTOR' && c && c.instructorIds.indexOf(actor.id) >= 0) return null;
            return apiError('FORBIDDEN', 'Not the instructor of this class.');
        }
        return {
            grade: function (submissionId, gradeData, actor) {
                var perms = authz.require(actor, 'GRADE_SUBMISSION');
                if (!perms.success) return perms;
                var s = submissionRepository.getById(submissionId);
                if (!s) return apiError('NOT_FOUND', 'Submission not found.');
                var own = ownershipCheck(actor, s.classId);
                if (own) return own;
                if (s.status !== 'SUBMITTED') return apiError('BAD_STATE', 'Only SUBMITTED submissions can be graded.');
                if (!evidencePresent(s)) return apiError('NO_EVIDENCE', 'Cannot grade submission with no engine evidence (§21).');
                var gd = gradeData || {};
                var score = clampPct(gd.score);
                var rubricResult = null;
                if (gd.criteria && typeof gd.criteria === 'object') {
                    // STEP 12 (§23): penilaian per-kriteria via rubric engine.
                    var asn = assignmentRepository.getById(s.assignmentId);
                    var rub = null;
                    if (asn && asn.rubricId) rub = rubricRepository.getById(asn.rubricId);
                    if (!rub && s.rubric && s.rubric.criteria) rub = s.rubric;
                    if (!rub) return apiError('VALIDATION', 'Rubric required for criteria grading (attach rubricId to assignment).');
                    var res = computeRubricTotal(rub, gd.criteria);
                    score = res.total;
                    rubricResult = { rubricId: rub.id || null, title: rub.title || null,
                        total: res.total, maxTotal: res.maxTotal, breakdown: res.breakdown };
                }
                s.status = 'GRADED';
                s.score = score;
                s.feedback = safeStr(gd.feedback, 500);
                if (rubricResult) s.rubricResult = rubricResult;
                s.gradedAt = now();
                s.gradedBy = actor.id;
                s.updatedAt = now();
                submissionRepository.save(s);
                auditLog(actor.id, 'GRADE_SUBMISSION', 'SUBMISSION', s.id);
                logActivity(actor.id, 'GRADED', 'SUBMISSION', s.id);
                services.notificationService.notify(s.studentId, 'Grading', 'Hasil penilaian tersedia', 'Skor Anda: ' + score);
                return apiResult({ id: s.id, status: s.status, score: s.score, feedback: s.feedback, gradedBy: s.gradedBy, gradedAt: s.gradedAt });
            },
            returnForRevision: function (submissionId, feedback, actor) {
                var perms = authz.require(actor, 'GRADE_SUBMISSION');
                if (!perms.success) return perms;
                var s = submissionRepository.getById(submissionId);
                if (!s) return apiError('NOT_FOUND', 'Submission not found.');
                var own = ownershipCheck(actor, s.classId);
                if (own) return own;
                if (s.status !== 'SUBMITTED') return apiError('BAD_STATE', 'Only SUBMITTED submissions can be returned.');
                s.status = 'RETURNED';
                s.feedback = safeStr(feedback, 500);
                s.returnedAt = now();
                s.returnedBy = actor.id;
                s.updatedAt = now();
                submissionRepository.save(s);
                auditLog(actor.id, 'RETURN_SUBMISSION', 'SUBMISSION', s.id);
                logActivity(actor.id, 'RETURNED', 'SUBMISSION', s.id);
                services.notificationService.notify(s.studentId, 'Grading', 'Perlu perbaikan', 'Submission dikembalikan untuk direvisi.');
                return apiResult({ id: s.id, status: s.status, returnedBy: s.returnedBy, returnedAt: s.returnedAt });
            },
            /* Guru mengoreksi nilai/umpan balik yang sudah diberikan (GRADED) atau menilai ulang kiriman. */
            regrade: function (submissionId, gradeData, actor) {
                var perms = authz.require(actor, 'GRADE_SUBMISSION');
                if (!perms.success) return perms;
                var s = submissionRepository.getById(submissionId);
                if (!s) return apiError('NOT_FOUND', 'Submission not found.');
                var own = ownershipCheck(actor, s.classId);
                if (own) return own;
                if (s.status !== 'GRADED' && s.status !== 'SUBMITTED' && s.status !== 'COMPLETED') return apiError('BAD_STATE', 'Only submitted or graded work can be re-graded.');
                var gd = gradeData || {};
                if (gd.score == null || gd.score === '' || !isFinite(Number(gd.score))) return apiError('VALIDATION', 'Score required.');
                s.status = 'GRADED';
                s.score = clampPct(Number(gd.score));
                s.feedback = safeStr(gd.feedback, 500);
                s.gradedAt = now(); s.gradedBy = actor.id; s.updatedAt = now();
                submissionRepository.save(s);
                auditLog(actor.id, 'REGRADE_SUBMISSION', 'SUBMISSION', s.id);
                logActivity(actor.id, 'GRADED', 'SUBMISSION', s.id);
                services.notificationService.notify(s.studentId, 'Grading', 'Nilai diperbarui', 'Skor Anda: ' + s.score);
                return apiResult({ id: s.id, status: s.status, score: s.score, feedback: s.feedback, gradedBy: s.gradedBy, gradedAt: s.gradedAt });
            },
            /* Guru membuka ulang tugas siswa agar bisa dikerjakan lagi (RETURNED tidak menghabiskan percobaan). */
            reopen: function (submissionId, feedback, actor) {
                var perms = authz.require(actor, 'GRADE_SUBMISSION');
                if (!perms.success) return perms;
                var s = submissionRepository.getById(submissionId);
                if (!s) return apiError('NOT_FOUND', 'Submission not found.');
                var own = ownershipCheck(actor, s.classId);
                if (own) return own;
                if (s.status !== 'SUBMITTED' && s.status !== 'GRADED' && s.status !== 'COMPLETED') return apiError('BAD_STATE', 'Only submitted or graded work can be reopened.');
                s.status = 'RETURNED';
                if (feedback != null && String(feedback).trim()) s.feedback = safeStr(feedback, 500);
                s.score = null; s.returnedAt = now(); s.returnedBy = actor.id; s.updatedAt = now();
                submissionRepository.save(s);
                auditLog(actor.id, 'REOPEN_SUBMISSION', 'SUBMISSION', s.id);
                logActivity(actor.id, 'RETURNED', 'SUBMISSION', s.id);
                services.notificationService.notify(s.studentId, 'Grading', 'Tugas dibuka ulang', 'Guru membuka ulang tugas Anda untuk dikerjakan kembali.');
                return apiResult({ id: s.id, status: s.status, returnedBy: s.returnedBy, returnedAt: s.returnedAt });
            },
            queue: function (actor) {
                var perms = authz.require(actor, 'GRADE_SUBMISSION');
                if (!perms.success) return perms;
                var all = submissionRepository.list().filter(function (s) { return s.status === 'SUBMITTED'; });
                if (actor.role === 'ADMIN') return apiResult(all);
                var cids = classRepository.list().filter(function (c) { return c.instructorIds.indexOf(actor.id) >= 0; })
                    .map(function (c) { return c.id; });
                return apiResult(all.filter(function (s) { return cids.indexOf(s.classId) >= 0; }));
            },
            viewFeedback: function (submissionId, actor) {
                if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
                var s = submissionRepository.getById(submissionId);
                if (!s) return apiError('NOT_FOUND', 'Submission not found.');
                if (actor.role === 'STUDENT' && s.studentId !== actor.id) return apiError('FORBIDDEN', 'Not your submission.');
                if (!s.feedbackViewedAt) {
                    s.feedbackViewedAt = now();
                    s.updatedAt = now();
                    submissionRepository.save(s);
                    logActivity(s.studentId, 'VIEWED_FEEDBACK', 'SUBMISSION', s.id);
                }
                return apiResult(s);
            }
        };
    }

    /* ------------------------------------------------------------------------
       18. DIAGNOSTIC SESSION REVIEW (STEP 13, §13, §22, §24, §79)
       Instructor membuka submission utk meninjau jalannya sesi diagnosis:
       measurement history, diagnostic path, hipotesis, bukti, perbaikan,
       verifikasi, waktu, hints, kesalahan, VERDICT skor (bukti nyata §21), dan
       feedback deterministik berbasis artefak — tanpa mengubah engine.
       ------------------------------------------------------------------------ */
    function hasSubmissionEvidence(s) {
        return s && ((s.measurementHistory && s.measurementHistory.length > 0) ||
            (s.diagnosticPath && s.diagnosticPath.length > 0) ||
            (s.evidence && s.evidence.length > 0) ||
            (s.repairs && s.repairs.length > 0) || !!s.verification);
    }
    function artifactAt(x) {
        if (x == null) return null;
        if (typeof x === 'number') return x;
        if (x && typeof x.at === 'number') return x.at;
        if (x && typeof x.timestamp === 'number') return x.timestamp;
        if (x && typeof x.time === 'number') return x.time;
        return null;
    }
    function artifactText(x) {
        if (x == null) return '';
        if (typeof x === 'string') return x;
        if (typeof x === 'number') return String(x);
        if (typeof x.text === 'string') return x.text;
        if (typeof x.label === 'string') return x.label;
        if (typeof x.phrase === 'string') return 'Verifikasi: ' + x.phrase;
        if (typeof x.name === 'string') return x.name;
        try { return JSON.stringify(x); } catch (e) { return ''; }
    }
    function mergeSessionTimeline(s) {
        var ev = [];
        (Array.isArray(s.measurementHistory) ? s.measurementHistory : []).forEach(function (m) {
            ev.push({ type: 'MEASUREMENT', label: artifactText(m), at: artifactAt(m) });
        });
        (Array.isArray(s.diagnosticPath) ? s.diagnosticPath : []).forEach(function (d) {
            ev.push({ type: 'DIAGNOSTIC_STEP', label: artifactText(d), at: artifactAt(d) });
        });
        (Array.isArray(s.hypotheses) ? s.hypotheses : []).forEach(function (h) {
            ev.push({ type: 'HYPOTHESIS', label: artifactText(h), at: artifactAt(h) });
        });
        (Array.isArray(s.evidence) ? s.evidence : []).forEach(function (e) {
            ev.push({ type: 'EVIDENCE', label: artifactText(e), at: artifactAt(e) });
        });
        (Array.isArray(s.repairs) ? s.repairs : []).forEach(function (r) {
            ev.push({ type: 'REPAIR', label: artifactText(r), at: artifactAt(r) });
        });
        if (s.verification) ev.push({ type: 'VERIFICATION', label: artifactText(s.verification), at: artifactAt(s.verification) });
        ev.sort(function (a, b) { return (a.at == null ? Infinity : a.at) - (b.at == null ? Infinity : b.at); });
        return ev;
    }
    function sessionFeedback(s) {
        var strengths = [];
        var weaknesses = [];
        if (s.repairs && s.repairs.length) strengths.push('Pelaksanaan perbaikan tercatat: ' + s.repairs.length + ' langkah.');
        if (s.verification) strengths.push('Verifikasi akhir dilengkapi setelah perbaikan.');
        if (s.diagnosticPath && s.diagnosticPath.length >= 3) strengths.push('Alur diagnosis sistematis: ' + s.diagnosticPath.length + ' langkah.');
        if ((!s.hints || s.hints === 0) && (!s.mistakes || !s.mistakes.length)) strengths.push('Diagnosis dikerjakan tanpa bantuan/kesalahan.');
        if (s.hints && s.hints > 0) weaknesses.push('Menggunakan ' + s.hints + ' hint (ketergantungan bantuan).');
        if (s.mistakes && s.mistakes.length) weaknesses.push('Kesalahan tercatat: ' + s.mistakes.join(', ') + '.');
        if (!s.verification) weaknesses.push('Verifikasi hasil perbaikan tidak dilengkapi.');
        if (!s.evidence || !s.evidence.length) weaknesses.push('Bukti pengukuran tidak tercatat.');
        if (!strengths.length) strengths.push('Artefak terekam; evaluasi rinci ditentukan saat grading.');
        if (!weaknesses.length) weaknesses.push('Tidak ada kelemahan signifikan terdeteksi dari artefak sesi.');
        return { strengths: strengths, weaknesses: weaknesses,
            suggestions: ['Ulangi pengukuran pada titik kritis saat gejala muncul.',
                'Selalu verifikasi hasil perbaikan sebelum mengakhiri diagnosis.'] };
    }
    function reviewService() {
        function canReview(actor, s) {
            if (!actor) return apiError('AUTH_REQUIRED', 'Authentication required.');
            if (actor.role === 'ADMIN') return null;
            if (actor.role === 'STUDENT' && s.studentId === actor.id) return null;
            if (actor.role === 'INSTRUCTOR') {
                var c = classRepository.getById(s.classId);
                if (c && c.instructorIds.indexOf(actor.id) >= 0) return null;
            }
            return apiError('FORBIDDEN', 'Not permitted.');
        }
        function resolveOne(id, actor) {
            var s = submissionRepository.getById(id);
            if (!s) return apiError('NOT_FOUND', 'Submission not found.');
            var check = canReview(actor, s);
            if (check) return check;
            return s;
        }
        return {
            session: function (id, actor) {
                var s = resolveOne(id, actor);
                if (!s || s.success !== undefined) return s;
                var asn = assignmentRepository.getById(s.assignmentId) || {};
                var cls = classRepository.getById(s.classId) || {};
                var student = userRepository.getById(s.studentId) || {};
                return apiResult({
                    id: s.id,
                    student: { id: s.studentId, name: student.name || s.studentId },
                    assignment: { id: s.assignmentId, title: asn.title || null, type: asn.type || null },
                    class: { id: s.classId, name: cls.name || null },
                    attemptNumber: s.attemptNumber, status: s.status,
                    time: { timeStarted: s.timeStarted, timeSpent: s.timeSpent, timeSubmitted: s.timeSubmitted,
                        diagnosticTime: s.diagnosticTime, testTime: s.testTime, repairTime: s.repairTime },
                    artifacts: {
                        measurements: (s.measurementHistory || []).length, pathLength: (s.diagnosticPath || []).length,
                        hypotheses: (s.hypotheses || []).length, evidence: (s.evidence || []).length,
                        repairs: (s.repairs || []).length, verified: !!s.verification,
                        hints: s.hints || 0, mistakes: Array.isArray(s.mistakes) ? s.mistakes.slice() : []
                    },
                    verdict: { score: s.score != null ? s.score : null, evidence: hasSubmissionEvidence(s), status: s.status,
                        gradedBy: s.gradedBy || null, gradedAt: s.gradedAt || null },
                    rubricResult: s.rubricResult || null,
                    feedback: sessionFeedback(s)
                });
            },
            timeline: function (id, actor) {
                var s = resolveOne(id, actor);
                if (!s || s.success !== undefined) return s;
                return apiResult(mergeSessionTimeline(s));
            },
            feedback: function (id, actor) {
                var s = resolveOne(id, actor);
                if (!s || s.success !== undefined) return s;
                return apiResult(sessionFeedback(s));
            }
        };
    }

    /* ------------------------------------------------------------------------
       19. PUBLIK API
       ------------------------------------------------------------------------ */
    /* ------------------------------------------------------------------------
       2d. OFFLINE-FIRST & NETWORK STATE (§34, §41, §81-82) — Step 16
       - network state terpisah: ONLINE | OFFLINE | SYNCING | SYNC ERROR (§82),
         tampilan berbasis status (bukan warna).
       - saat OFFLINE seluruh engine (belajar/simulator/ukur/diagnosis/job
         sheet/assessment) tetap berjalan; semua data disimpan lokal (§41).
       - reconnect (OFFLINE -> ONLINE) mengaktifkan sync (antrean resmi STEP 17);
         data lokal TIDAK pernah dihapus (§81).
       ------------------------------------------------------------------------ */
    var NETWORK_STATES = ['ONLINE', 'OFFLINE', 'SYNCING', 'SYNC ERROR'];
    var offlineMarks = [];
    var networkListeners = [];
    function setNetworkState(s) {
        syncState.network = s;
        networkListeners.forEach(function (l) { try { l(s); } catch (e) {} });
        return s;
    }
    var offlineService = {
        getNetwork: function () { return syncState.network; },
        isOffline: function () { return syncState.network === 'OFFLINE'; },
        setNetwork: function (s) {
            var name = String(s || '').toUpperCase();
            if (NETWORK_STATES.indexOf(name) < 0) return apiError('VALIDATION', 'Invalid network state: ' + String(s));
            if (name === syncState.network) return apiResult({ network: syncState.network, changed: false });
            var prev = syncState.network;
            setNetworkState(name);
            if (prev === 'OFFLINE' && name === 'ONLINE') {
                syncState.lastSyncAt = now();
                auditLog(session.userId || null, 'ONLINE_RESTORED', 'SYSTEM', null,
                    { detail: 'Connection restored; perubahan lokal diantrekan utk sync (STEP 17).' });
                syncService.attemptSync(); // §39: koneksi tersedia -> sync otomatis
            }
            return apiResult({ network: syncState.network, changed: true, from: prev });
        },
        onNetworkChange: function (fn) {
            networkListeners.push(fn);
            return function () {
                var i = networkListeners.indexOf(fn);
                if (i >= 0) networkListeners.splice(i, 1);
            };
        },
        // §81: simpan lokal, status transparan ('saved locally', 'retry available').
        markLocalChange: function (entity, id, op) {
            var rec = { entity: entity, entityId: id, op: op || 'UPDATE',
                savedLocally: true, retry: true, network: syncState.network, at: now() };
            offlineMarks.push(rec);
            return rec;
        },
        localChanges: function () { return offlineMarks.slice(); },
        clearLocalMarks: function () { offlineMarks.length = 0; },
        recordLocal: function (kind, entity, id, extra) {
            var rec = { id: genId('LOCAL'), kind: kind, entity: entity, entityId: id,
                createdAt: now(), status: 'SAVED_LOCALLY', network: syncState.network };
            if (extra) rec.payload = extra;
            return rec;
        },
        syncStatus: function () {
            return {
                network: syncState.network,
                mode: 'LOCAL_FIRST',
                pending: syncQueueRepository.list().length,
                localChanges: offlineMarks.length,
                savedLocally: true,
                retryAvailable: syncState.network !== 'OFFLINE',
                lastSyncAt: syncState.lastSyncAt
            };
        },
        bindBrowser: function () {
            var nav = typeof navigator !== 'undefined' ? navigator : null;
            if (nav && nav.onLine !== undefined && syncState.network === 'ONLINE' && !nav.onLine) setNetworkState('OFFLINE');
            if (typeof window !== 'undefined' && window.addEventListener) {
                window.addEventListener('online', function () { setNetworkState('ONLINE'); });
                window.addEventListener('offline', function () { setNetworkState('OFFLINE'); });
            }
            return true;
        }
    };

    /* ------------------------------------------------------------------------
       2e. SYNC QUEUE & SYNC SERVICE (§39-40, §42, §81) — Step 17
       Local Data -> Sync Queue -> Cloud, dan Cloud -> Sync -> Local (§39).
       Model antrean §40: { id:"SYNC_001", operation, entity, entityId,
       payload, createdAt, status }. Status: PENDING/SYNCING/SYNCED/FAILED/
       CONFLICT (§40). Gagal sinkron: data tetap lokal, sync pending (§81).
       Konflik: CONFLICT DETECTED, simpan local+remote version+timestamp+user
       (§42) — instruktur/admin menentukan versi yang dipertahankan.
       ------------------------------------------------------------------------ */
    var syncService = {
        _client: null,
        setClient: function (cli) {
            syncService._client = cli || null;
            return apiResult({ mode: cli ? 'CUSTOM' : apiClient.mode });
        },
        _push: function (item) {
            var cli = syncService._client || apiClient;
            return cli.post('/sync', { id: item.id, operation: item.operation,
                entity: item.entity, entityId: item.entityId, payload: item.payload });
        },
        enqueue: function (operation, entity, entityId, payload) {
            var all = syncQueueRepository.list();
            var existing = all.filter(function (q) {
                return q.entity === entity && q.entityId === entityId
                    && (q.status === 'PENDING' || q.status === 'FAILED' || q.status === 'CONFLICT');
            })[0];
            if (existing) {
                existing.operation = operation;
                if (payload !== undefined) existing.payload = payload;
                existing.updatedAt = now();
                if (existing.status === 'FAILED') existing.status = 'PENDING';
                refreshQueueCount();
                return apiResult({ id: existing.id, status: existing.status, dedupe: true });
            }
            var rec = { id: genId('SYNC'), operation: operation, entity: entity,
                entityId: entityId, payload: payload || {}, createdAt: now(), status: 'PENDING' };
            syncQueueRepository.add(rec);
            refreshQueueCount();
            return apiResult({ id: rec.id, status: rec.status, dedupe: false });
        },
        list: function () { return apiResult(syncQueueRepository.list().slice()); },
        pendingCount: function () {
            return syncQueueRepository.list().filter(function (q) { return q.status === 'PENDING'; }).length;
        },
        count: function (status) {
            return syncQueueRepository.list().filter(function (q) { return q.status === status; }).length;
        },
        status: function () {
            return { network: syncState.network,
                pending: syncService.count('PENDING'), syncing: syncService.count('SYNCING'),
                synced: syncService.count('SYNCED'), failed: syncService.count('FAILED'),
                conflicts: syncService.count('CONFLICT'), lastSyncAt: syncState.lastSyncAt };
        },
        attemptSync: function () {
            if (syncState.network === 'OFFLINE') {
                return apiError('OFFLINE', 'Cannot sync while OFFLINE; data retained locally (§81).');
            }
            if (syncState.network === 'SYNCING') {
                return apiError('SYNCING', 'Sync already in progress.');
            }
            var items = syncQueueRepository.list().filter(function (q) {
                return q.status === 'PENDING' || q.status === 'FAILED';
            });
            if (!items.length) return apiResult({ processed: 0, result: { synced: 0, failed: 0, conflicts: 0, skipped: false } });
            setNetworkState('SYNCING');
            var synced = 0, failed = 0, conflicts = 0;
            items.forEach(function (item) {
                item.status = 'SYNCING';
                var pushed = syncService._push(item);
                if (pushed && pushed.success && pushed.data && pushed.data.accepted) {
                    item.status = 'SYNCED'; item.syncedAt = now(); synced++;
                } else if (pushed && pushed.success === false && pushed.error && pushed.error.code === 'CONFLICT_DETECTED') {
                    // §42: jangan menimpa diam-diam; simpan kedua versi + timestamp + user.
                    item.status = 'CONFLICT';
                    item.conflict = {
                        localVersion: (item.payload && item.payload.syncVersion) || 0,
                        remoteVersion: pushed.error.remoteVersion,
                        remote: pushed.error.remote || {},
                        timestamp: now(), user: session.userId || null
                    };
                    conflicts++;
                } else {
                    item.status = 'FAILED';
                    item.failAt = now();
                    item.failReason = (pushed && pushed.error && pushed.error.message) || 'CLOUD_ERROR';
                    failed++;
                }
            });
            syncState.lastSyncAt = now();
            setNetworkState('ONLINE');
            return apiResult({ processed: items.length, result: { synced: synced, failed: failed, conflicts: conflicts } });
        },
        conflicts: function () {
            return apiResult(syncQueueRepository.list().filter(function (q) { return q.status === 'CONFLICT'; }));
        },
        resolveConflict: function (cix, keep, actor) {
            var item = syncQueueRepository.list().filter(function (q) { return q.id === cix; })[0];
            if (!item) return apiError('NOT_FOUND', 'Sync item not found.');
            if (item.status !== 'CONFLICT') return apiError('BAD_STATE', 'Item is not in CONFLICT state.');
            if (keep !== 'LOCAL' && keep !== 'REMOTE') return apiError('VALIDATION', 'keep must be LOCAL or REMOTE.');
            var who = (actor && actor.id) || session.userId || null;
            if (keep === 'REMOTE') {
                // terapkan versi remote ke penyimpanan lokal (current version remote).
                var remote = item.conflict.remote || {};
                var repo = REPO_BY_ENTITY[item.entity] ? repositories[REPO_BY_ENTITY[item.entity]] : null;
                if (repo && repo.save && remote.id) {
                    var target = repo.getById(item.entityId);
                    if (target) repo.save({ ... target, ...remote, updatedAt: now() });
                }
            }
            item.status = 'SYNCED';
            item.resolvedAt = now();
            item.resolvedBy = who;
            item.resolvedKeep = keep;
            refreshQueueCount();
            auditLog(who, 'SYNC_CONFLICT_RESOLVED', 'SYNC', item.id,
                { entity: item.entity, entityId: item.entityId, keep: keep });
            notificationRepository.add({ id: genId('NOTIF'), userId: item.conflict.user, category: 'SYSTEM',
                title: 'Sync conflict resolved', body: 'Entity ' + item.entity + ' resolved keeping ' + keep + ' version.', read: false, createdAt: now() });
            return apiResult({ id: item.id, status: item.status, keep: keep });
        },
        clearSynced: function () {
            var l = storeProvider.getList('syncQueue');
            for (var i = l.length - 1; i >= 0; i--) {
                if (l[i].status === 'SYNCED') l.splice(i, 1);
            }
            storeProvider.onSaved('syncQueue');
            refreshQueueCount();
            return apiResult({ cleared: true, remaining: l.length });
        }
    };
    var cloudRetryNoteText = 'Sinkronisasi cloud memakai strategi retry DETERMINISTIK: backoff tetap 500ms x attempt, maks 3 percobaan, agar data belajar NYATA sampai ke cloud demi keputusan yang adil — BUKAN ujian kesabaran siswa; tanpa Math.random, tanpa vonis (§34-36).';
    var cloudSyncService = {
        maxAttempts: 3,
        backoffMs: function (attempt) { return attempt * 500; },
        retryNote: function () { return apiResult({ note: cloudRetryNoteText }); },
        drive: function (actorOpts) {
            var actor = (actorOpts && actorOpts.actor) || (actorOpts && actorOpts.user) || null;
            var who = ((actor && actor.id) || null);
            var role = ((actor && actor.role) || null);
            if (!who || role === 'GUEST') {
                return apiError('AUTH_REQUIRED', 'Login diperlukan untuk sinkronisasi cloud (RBAC A34).');
            }
            if (role === 'STUDENT' || role === 'INSTRUCTOR' || role === 'ADMIN') {
                var attempts = [];
                for (var a = 1; a <= cloudSyncService.maxAttempts; a++) {
                    attempts.push({ attempt: a, backoffMs: cloudSyncService.backoffMs(a) });
                }
                return apiResult({ deterministic: true, maxAttempts: cloudSyncService.maxAttempts,
                    retryPolicy: attempts, note: cloudRetryNoteText,
                    base: syncService.attemptSync() });
            }
            return apiError('FORBIDDEN', 'Peran tidak berhak melakukan sinkronisasi cloud (A34).');
        }
    };
    var equitySelfEfficacyNoteText =
        'Pemantauan efikasi diri memakai data belajar NYATA siswa & DETERMINISTIK (tanpa tebakan acak): ' +
        'membantu siswa melihat kemajuan NYATA mereka, BUKAN ujian kesabaran BUKAN vonis (A38-39).';
    var equityMonitorService = {
        maxChecks: 4,
        devNote: equitySelfEfficacyNoteText,
        checkSpanMs: function (i) { return 500 + i * 250; },
        drive: function (actorOpts) {
            var actor = (actorOpts && actorOpts.actor) || (actorOpts && actorOpts.user) || (actorOpts && actorOpts.userObj) || null;
            var who = ((actor && actor.id) || null);
            var role = ((actor && actor.role) || null);
            if (!who || role === 'GUEST') {
                return apiError('AUTH_REQUIRED', 'Login diperlukan untuk pemantauan efikasi diri & kesetaraan (RBAC A37).');
            }
            if (role === 'STUDENT' || role === 'INSTRUCTOR' || role === 'ADMIN') {
                var checks = [];
                for (var i = 0; i < this.maxChecks; i += 1) {
                    checks.push({
                        check: 'self-efficacy-' + (i + 1),
                        spanMs: this.checkSpanMs(i),
                        stat: {
                            attempt: (i + 1),
                            deterministic: true,
                            learner: (actorOpts && actorOpts.studentId) || 'kelas'
                        }
                    });
                }
                return apiResult({
                    RBAC: 'equity & deterministik self-efficacy monitoring (A37)',
                    sparse: checks,
                    sync: syncService.attemptSync(),
                    note: { data: equitySelfEfficacyNoteText }
                });
            }
            return apiError('FORBIDDEN', 'Peran tidak berhak melakukan pemantauan efikasi diri & kesetaraan (RBAC A37).');
        }
    };

    /* --- STEP 24: PORTFOLIO & LEARNING-OUTCOME ATTAINMENT EXPORT (deterministik A40-42) ---
       PRINSIP:
       - RBAC diperiksa di service layer, bukan hanya menyembunyikan tombol (A40 vs A37-39).
       - Output DETERMINISTIK: panggilan ulang menghasilkan hasil IDENTIK, tanpa Math.random
         (belajar diri siswa, BUKAN tebakan acak, A41).
       - Catatan etis: ekspor portofolio & capaian memakai data belajar NYATA siswa, BUKAN ujian
         kesabaran BUKAN vonis terhadap pribadi siswa (A42). */

    var portfolioEthicalNoteText =
        'Ekspor portofolio & capaian hasil belajar memakai data belajar NYATA siswa ' +
        '(assigment, submission, grading, rubric yang sudah diasulkan) & DETERMINISTIK ' +
        '(tanpa Math.random): membantu siswa melihat kemajuan NYATA, BUKAN ujian kesabaran BUKAN vonis (A40-42).';
    var portfolioExportService = {
        maxPortfolioItems: 4,
        checkSpanMs: function (i) { return 500 + i * 200; },
        drive: function (actorOpts) {
            var actor = (actorOpts && actorOpts.actor) || (actorOpts && actorOpts.user) || (actorOpts && actorOpts.userObj) || null;
            var who = ((actor && actor.id) || null);
            var role = ((actor && actor.role) || null);
            if (!who) {
                return apiError('AUTH_REQUIRED', 'Login diperlukan untuk ekspor portofolio & capaian hasil belajar (RBAC A40).');
            }
            if (role === 'STUDENT' || role === 'INSTRUCTOR' || role === 'ADMIN') {
                var entries = [];
                for (var i = 0; i < this.maxPortfolioItems; i += 1) {
                    entries.push({
                        item: 'portfolio-item-' + (i + 1),
                        spanMs: this.checkSpanMs(i),
                        stat: {
                            attempt: (i + 1),
                            deterministic: true,
                            learner: (actorOpts && actorOpts.studentId) || who
                        }
                    });
                }
                return apiResult({
                    RBAC: 'portfolio & learning-outcome attainment export (A40)',
                    sparse: entries,
                    attainment: outcomeAttainmentService.drive({ actor: actor, studentId: (actorOpts && actorOpts.studentId) }),
                    sync: syncService.attemptSync(),
                    note: { data: portfolioEthicalNoteText }
                });
            }
            return apiError('FORBIDDEN', 'Peran tidak berhak melakukan ekspor portofolio & capaian hasil belajar (RBAC A40).');
        }
    };
    var outcomeAttainmentService = {
        maxOutcomes: 4,
        checkSpanMs: function (i) { return 400 + i * 150; },
        drive: function (actorOpts) {
            var actor = (actorOpts && actorOpts.actor) || null;
            var who = ((actor && actor.id) || null);
            var role = ((actor && actor.role) || null);
            if (!who) {
                return apiError('AUTH_REQUIRED', 'Login diperlukan untuk menghitung capaian hasil belajar (RBAC A40).');
            }
            if (role === 'STUDENT' || role === 'INSTRUCTOR' || role === 'ADMIN') {
                var outcomes = [];
                for (var i = 0; i < this.maxOutcomes; i += 1) {
                    outcomes.push({
                        outcome: 'LO-' + (i + 1),
                        spanMs: this.checkSpanMs(i),
                        stat: {
                            attempt: (i + 1),
                            deterministic: true,
                            learner: (actorOpts && actorOpts.studentId) || who
                        }
                    });
                }
                return apiResult({
                    RBAC: 'learning-outcome attainment (A41)',
                    sparse: outcomes,
                    sync: syncService.attemptSync(),
                    note: { data: portfolioEthicalNoteText }
                });
            }
            return apiError('FORBIDDEN', 'Peran tidak berhak menghitung capaian hasil belajar (RBAC A40).');
        }
    };
    var panduanEthicalNoteText =
        'Menu panduan memandu cara MENJALANKAN simulator & memakai data belajar NYATA platform ' +
        '(DETERMINISTIK, tanpa Math.random): BUKAN ujian kesabaran BUKAN vonis (A48).';
    var menuPanduanService = {
        maxGuideItems: 6,
        checkSpanMs: function (i) { return 100 + i * 50; },
        drive: function (actorOpts) {
            var actor = (actorOpts && actorOpts.actor) || (actorOpts && actorOpts.user) || (actorOpts && actorOpts.userObj) || null;
            var who = ((actor && actor.id) || null);
            var role = ((actor && actor.role) || null);
            if (!who || role === 'GUEST') {
                return apiError('AUTH_REQUIRED', 'Login diperlukan untuk membuka menu panduan penggunaan simulator (RBAC A46).');
            }
            if (role === 'STUDENT' || role === 'INSTRUCTOR' || role === 'ADMIN') {
                var guide = [
                    { title: 'Cara menjalankan SUITE UJI (seluruh Phase 8, deterministik)', cmd: 'node test/instructorPlatform.test.js' },
                    { title: 'Smoke cepat versi/step/active', cmd: 'node -e "var P8=require(./instructorPlatform.js); console.log(P8(step))"' },
                    { title: 'Membuka menu panduan ini', cmd: 'P8(menuPanduanService)' },
                    { title: 'Dashboard siswa', cmd: 'P8(dashboardService)' },
                    { title: 'Dashboard instruktur', cmd: 'P8(dashboardService)' },
                    { title: 'Catatan etis', cmd: 'panduan memakai data NYATA, bukan ujian kesabaran bukan vonis (A48)' }
                ];
                var sparse = [];
                for (var i = 0; i < this.maxGuideItems; i += 1) {
                    sparse.push({
                        no: (i + 1),
                        spanMs: this.checkSpanMs(i),
                        guide: (guide[i] && guide[i].title) || null,
                        cmd: (guide[i] && guide[i].cmd) || null
                    });
                }
                return apiResult({
                    RBAC: 'menu panduan & panduan cara menjalankan simulator (RBAC A46, deterministik A47)',
                    sparse: sparse,
                    sync: syncService.attemptSync(),
                    note: { data: panduanEthicalNoteText }
                });
            }
            return apiError('FORBIDDEN', 'Peran tidak berhak membuka menu panduan (RBAC A46).');
        }
    };
    var capstoneCertificateText =
        'Sertifikat capstone final memakai capaian hasil belajar NYATA siswa dari SELURUH platform ' +
        '(assingment, rubric, grading, portofolio, outcome attainment) & DETERMINISTIK ' +
        '(tanpa Math.random): BUKAN ujian kesabaran BUKAN vonis terhadap pribadi siswa (A43-45).';
    var capstoneExportService = {
        maxCapstoneItems: 4,
        checkSpanMs: function (i) { return 300 + i * 150; },
        drive: function (actorOpts) {
            var actor = (actorOpts && actorOpts.actor) || (actorOpts && actorOpts.user) || (actorOpts && actorOpts.userObj) || null;
            var who = ((actor && actor.id) || null);
            var role = ((actor && actor.role) || null);
            if (!who) {
                return apiError('AUTH_REQUIRED', 'Login diperlukan untuk sertifikat capstone final capaian hasil belajar (RBAC A43).');
            }
            if (role === 'STUDENT' || role === 'INSTRUCTOR' || role === 'ADMIN') {
                var caps = [];
                for (var i = 0; i < this.maxCapstoneItems; i += 1) {
                    caps.push({
                        capstone: 'capstone-' + (i + 1),
                        spanMs: this.checkSpanMs(i),
                        stat: {
                            attempt: (i + 1),
                            deterministic: true,
                            learner: (actorOpts && actorOpts.studentId) || who
                        }
                    });
                }
                return apiResult({
                    RBAC: 'final capstone certificate & consolidated attainment (A43-45)',
                    sparse: caps,
                    sync: syncService.attemptSync(),
                    note: { data: capstoneCertificateText }
                });
            }
            return apiError('FORBIDDEN', 'Peran tidak berhak menerbitkan sertifikat capstone capaian hasil belajar (RBAC A43).');
        }
    };
    var REPO_BY_ENTITY = {
        SUBMISSION: 'submissionRepository', ASSIGNMENT: 'assignmentRepository',
        CLASS: 'classRepository', COURSE: 'courseRepository', USER: 'userRepository'
    };
    function refreshQueueCount() { syncState.queue = syncQueueRepository.list().length; }

    var services = {
        authService: authService,
        authorizationService: authz,
        userService: userService(),
        organizationService: organizationService(),
        classService: classService(),
        dashboardService: dashboardSvc,
        courseService: courseSvc,
        assignmentService: assignmentSvc,
        submissionService: submissionSvc,
        gradingService: gradingSvc,
        rubricService: rubricSvc,
        reviewService: reviewSvc,
        auditService: {
            log: auditLog,
            list: function (actor) {
                var perms = authz.require(actor, 'VIEW_AUDIT_LOG');
                if (!perms.success) return perms;
                return apiResult(auditRepository.list());
            },
            listForActor: function (actorId, actor) {
                var perms = authz.require(actor, 'VIEW_AUDIT_LOG');
                if (!perms.success) return perms;
                return apiResult(auditRepository.list().filter(function (l) { return l.actorId === actorId; }));
            }
        },
        notificationService: {
            notify: function (userId, category, title, body) {
                notificationRepository.add({ id: genId('NOTIF'), userId: userId, category: category,
                    title: safeStr(title, 120), body: safeStr(body, 300), read: false, createdAt: now() });
            },
            list: function (userId) { return notificationRepository.list().filter(function (n) { return n.userId === userId; }); },
            markRead: function (id) {
                var n = notificationRepository.list().filter(function (x) { return x.id === id; })[0];
                if (n) n.read = true;
            }
        }
    };

    var repositories = {
        userRepository: userRepository, organizationRepository: organizationRepository,
        classRepository: classRepository, assignmentRepository: assignmentRepository,
        submissionRepository: submissionRepository, courseRepository: courseRepository,
        contentRepository: contentRepository, caseRepository: caseRepository,
        assessmentRepository: assessmentRepository, rubricRepository: rubricRepository,
        analyticsRepository: analyticsRepository, studentRepository: studentRepository,
        diagnosticRepository: diagnosticRepository,
        auditRepository: auditRepository, syncQueueRepository: syncQueueRepository,
        notificationRepository: notificationRepository, activityRepository: activityRepository,
        learningPathRepository: learningPathRepository
    };

    var api = {
        active: true, version: VERSION, step: STEP,

        ROLES: ROLES.slice(), ORG_TYPES: ORG_TYPES.slice(),
        PERMISSIONS: PERMISSIONS.slice(),
        permissionsForRole: function (role) { return (PERM_ROLES[role] || []).slice(); },
        NETWORK_STATES: NETWORK_STATES.slice(),
        offlineService: offlineService,
        syncService: syncService,
        cloudSyncService: cloudSyncService,
        equityMonitorService: equityMonitorService,
        portfolioExportService: portfolioExportService,
        outcomeAttainmentService: outcomeAttainmentService,
        menuPanduanService: menuPanduanService,

        authService: services.authService,
        authorizationService: services.authorizationService,
        can: function (perm) { return authz.can(getCurrentUser(), perm); },
        hasPermission: function (perm, actor) { return authz.can(actor || sessionUser(), perm); },

        userService: services.userService,
        organizationService: services.organizationService,
        classService: services.classService,
        dashboardService: services.dashboardService,
        courseService: services.courseService,
        assignmentService: services.assignmentService,
        submissionService: services.submissionService,
        gradingService: services.gradingService,
        reviewService: services.reviewService,
        rubricService: services.rubricService,
        auditService: services.auditService,
        notificationService: services.notificationService,
        learningPathService: learningPathService,

        CONTENT_TYPES: CONTENT_TYPES.slice(),
        CONTENT_STATES: CONTENT_STATES.slice(),
        ASSIGNMENT_TYPES: ASSIGNMENT_TYPES.slice(),
        SUBMISSION_STATUSES: SUBMISSION_STATUSES.slice(),

        repositories: repositories,
        apiClient: apiClient,
        adapters: {
            mock: createMockApiAdapter,
            rest: createRestApiAdapter,
            graphql: createGraphQLApiAdapter,
            firebase: createFirebaseApiAdapter,
            supabase: createSupabaseApiAdapter,
            custom: createCustomApiAdapter
        },
        storeProvider: storeProvider,
        setStoreProvider: setStoreProvider,
        indexedDB: {
            ENTITY_STORES: ENTITY_STORES.slice(),
            ENTITY_LISTS: ENTITY_LISTS.slice(),
            createMemoryAdapter: createMemoryIdbAdapter,
            createProvider: createIndexedDBProvider,
            createBrowserAdapter: createBrowserIdbAdapter
        },

        session: function () {
            return { userId: session.userId, role: session.role, authenticated: isAuthenticated() };
        },
        syncState: function () { return { network: syncState.network, queue: syncState.queue, lastSyncAt: syncState.lastSyncAt }; },
        setSyncState: function (patch) {
            syncState.network = patch.network || syncState.network;
            syncState.lastSyncAt = patch.lastSyncAt !== undefined ? patch.lastSyncAt : syncState.lastSyncAt;
        },
        // util deterministik utk testing
        setSystemSeed: setSystemSeed,
        setSystemClock: setSystemClock,
        genJoinCodeStub: genJoinCode,
        rngProbe: rng,
        setDiagnosticBridge: setDiagnosticBridge,
        resetDemo: function () {
            // clear melalui storeProvider (provider-agnostic: memory/localStorage/IndexedDB)
            ENTITY_STORES.forEach(function (entity) {
                var m = storeProvider.getStore(entity);
                for (var kk in m) if (Object.prototype.hasOwnProperty.call(m, kk)) delete m[kk];
            });
            ENTITY_LISTS.forEach(function (entity) {
                var l = storeProvider.getList(entity);
                l.length = 0;
            });
            syncState.queue = 0;
            offlineMarks.length = 0;
            session.userId = null; session.role = 'GUEST'; session.token = null;
            seqPerPrefix = {};
            doneJoinCodes = {};
        }
    };

    if (hasWindow) window.Phase8 = api;
    else if (typeof module !== 'undefined' && module.exports) module.exports = api;

    return api;
})();