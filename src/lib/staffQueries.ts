/** The staff dashboard's cache key and fetcher, shared by its section (desktop + web) and the desktop warm-up. */
export const staffDashboardKey = (groupId: string) => `staff:dashboard:${groupId}`
export const fetchStaffDashboard = (groupId: string) => window.api.collabStaffDashboard(groupId)
