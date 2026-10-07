import { resolve } from '$app/paths';

/**
 * Every route the sidebar links to.
 *
 * Kept as a union rather than `string` so `resolve()` stays type-checked against
 * SvelteKit's generated route ids; adding a page means adding its path here.
 */
export type NavPath = '/' | '/upload' | '/photos' | '/users' | '/server' | '/about';

export interface NavItem {
  /** Text shown in the sidebar and reused as the page title. */
  label: string;
  /** Route id; the sidebar resolves it so a future `base` keeps working. */
  path: NavPath;
  /** One-line hint rendered under the active page title. */
  description: string;
  /** `d` attribute for a 24x24 stroke icon, so the sidebar needs no icon library. */
  icon: string;
}

/**
 * The sidebar is generated from this list, so adding a page is one entry here
 * plus its route folder.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  {
    label: 'Main',
    path: '/',
    description: 'Overview of this instance',
    icon: 'M3 10.6 12 3l9 7.6M5 9.5V21h14V9.5',
  },
  {
    label: 'Upload',
    path: '/upload',
    description: 'Upload assets to this instance',
    icon: 'M12 3v12m0-12-4 4m4-4 4 4M5 15v4a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-4',
  },
  {
    label: 'Photos',
    path: '/photos',
    description: 'Everything uploaded to this instance',
    icon: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M9 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  },
  {
    label: 'User management',
    path: '/users',
    description: 'Create, edit and remove users',
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  },
  {
    label: 'Server',
    path: '/server',
    description: 'Runtime and build details',
    icon: 'M4 5h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm0 9h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1ZM7 8h.01M7 17h.01',
  },
  {
    label: 'About',
    path: '/about',
    description: 'What this app is',
    icon: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 16v-4M12 8h.01',
  },
];

/**
 * Matches an item against a pathname. Nested routes (`/users/42`) belong to
 * their parent item; the root item only matches `/` exactly.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const href = resolve(item.path);

  if (href === '/') {
    return pathname === '/';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Finds the nav item that owns a pathname, or `undefined` for unknown routes. */
export function findNavItem(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isNavItemActive(item, pathname));
}
