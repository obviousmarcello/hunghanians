/** Raised when a registration for the same event and email already exists. */
export class DuplicateError extends Error {
    constructor() {
        super('Duplicate registration');
        this.name = 'DuplicateError';
    }
}
