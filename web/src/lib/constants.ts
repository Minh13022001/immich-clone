/**
 * Web-side constants.
 *
 * `USER_NAME_MAX_LENGTH` / `USER_EMAIL_MAX_LENGTH` intentionally mirror the
 * server's values. The server remains the authority (it validates every
 * request); the client copy only exists so the inputs can stop the user before
 * a round trip.
 */
export const USER_NAME_MAX_LENGTH = 255;
export const USER_EMAIL_MAX_LENGTH = 320;
