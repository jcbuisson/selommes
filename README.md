  - High: server-side deletions can be resurrected by stale clients.
    In backend/node_modules/@jcbuisson/express-x-drizzle/src/drizzle-plugins.mjs:130, sync.go only loads metadata for rows still
    present in the model table. But deleteWithMeta hard-deletes the model row and leaves only a metadata tombstone. When an
    offline client later syncs with an old local copy, backend/node_modules/@jcbuisson/express-x/src/server.mjs:71 sees “client-
    only, not deleted” and returns addDatabase, recreating the deleted row. There is already a test describing this exact broken
    behavior at backend/node_modules/@jcbuisson/express-x/test/offline.test.mjs:381.
    Fix direction: when building sync state, also fetch metadata for client-provided UIDs. If the DB has a tombstone with
    deleted_at, return deleteClient instead of addDatabase.

  - High: app startup can skip synchronization when IndexedDB already has a persisted whereList.
    On first socket connect, frontend/node_modules/@jcbuisson/express-x-client/src/client.mts:353 only calls synchronizeAll() if
    app.disconnectedDate is set. On component mount, frontend/node_modules/@jcbuisson/express-x-client/src/client.mts:299 only
    synchronizes when addSynchroWhere(where) returns isNew. If the browser already has whereList from a previous run, isNew is
    false and no initial sync fires. That means stale cache can survive a restart indefinitely until a new filter is added or the
    cache is manually cleared. This matches your earlier “clear IndexedDB on start” concern, but the underlying sync bug is that
    initial sync depends on “new where” rather than “active where”.
    Fix direction: after model creation or once connected, run synchronizeAll() for existing whereList, or make getObservable sync
    when connected even if the where already exists.

  - Medium: scoped sync can overwrite records that moved out of scope.
    sync.go compares only rows currently matching where (backend/node_modules/@jcbuisson/express-x-drizzle/src/drizzle-
    plugins.mjs:130). If a record previously in a client’s scope is updated elsewhere so it no longer matches that scope, the
    server will omit it. The stale client still has it locally, so the algorithm treats it as client-only and sends addDatabase;
    createWithMeta then upserts on UID conflict (backend/node_modules/@jcbuisson/express-x-drizzle/src/drizzle-plugins.mjs:68),
    potentially moving the server record back to stale data. Your current ranges$({}) all-record subscription avoids this for
    ranges, but the mechanism is unsafe for narrower filters.
    