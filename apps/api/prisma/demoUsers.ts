/** The demo accounts that share the public development password. The seed creates them and `demo:off` switches them off. */
export const DEMO_USERS = [
  { email: 'ana.reyes@example.com', name: 'Ana Reyes', role: 'medref', branch: 'Cebu North' },
  { email: 'mark.dc@example.com', name: 'Mark Dela Cruz', role: 'medref', branch: 'Cebu South' },
  { email: 'liza.santos@example.com', name: 'Liza Santos', role: 'checker', branch: 'Head Office' },
  { email: 'paolo.v@example.com', name: 'Paolo Villanueva', role: 'approver', branch: 'Head Office' },
  { email: 'accounting@example.com', name: 'Rica Tan', role: 'accounting', branch: 'Head Office' },
  { email: 'admin@example.com', name: 'Admin User', role: 'admin', branch: 'Head Office' },
] as const;

export const DEMO_EMAILS: string[] = DEMO_USERS.map((u) => u.email);

/** Once the demo accounts have been switched off (a live system), re-seeding during an upgrade must not bring any back, new ones included. */
export const demoUsersToCreate = (retired: boolean) => (retired ? [] : [...DEMO_USERS]);
