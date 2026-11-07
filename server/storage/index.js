export { DuplicateError } from './errors.js';
export { createResilientStorage, ServiceUnavailableError } from './resilient.js';

/**
 * Opens the store described by `config.database` (see databaseConfig in
 * config.js). Both stores expose the same async interface:
 *
 *   ping, close,
 *   createMessage, listMessages, setMessageHandled,
 *   createRegistration (throws DuplicateError), getRegistration, listRegistrations,
 *   setRegistrationStatus, registrationSummary, headcount
 */
export async function openStorage(database) {
    if (database.client === 'mysql') {
        const { openMysql } = await import('./mysql.js');
        return openMysql(database);
    }
    const { openSqlite } = await import('./sqlite.js');
    return openSqlite(database.path);
}
