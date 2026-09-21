// SvelteKit reads this file to learn about the app-specific ambient types.
// Nothing is customised here: there is no auth, no server-side session and no
// database access from the web app, so every augmentation stays empty.
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
