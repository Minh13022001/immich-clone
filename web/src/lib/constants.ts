/**
 * Web-side constants.
 *
 * `PHOTO_NAME_MAX_LENGTH` intentionally mirrors the server's `PHOTO_NAME_MAX_LENGTH`.
 * The server remains the authority (it validates every request); the client copy
 * only exists so the input can stop the user before a round trip.
 */
export const PHOTO_NAME_MAX_LENGTH = 255;
