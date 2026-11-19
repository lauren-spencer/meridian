/**
 * Phase 0 Security TDD Specification & Adversarial Test Suite
 * Verifies all 12 "Dirty Dozen" attack payloads against firestore.rules.
 * Run with Firebase Emulator Suite (@firebase/rules-unit-testing) when testing locally.
 */

export interface AdversarialCase {
  id: string;
  title: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
  enforcedBy: string;
}

export const DIRTY_DOZEN_CASES: AdversarialCase[] = [
  {
    id: 'DD-01',
    title: 'Cross-Tenant Profile Read (PII Blanket Test)',
    operation: 'get',
    path: '/users/userA',
    auth: { uid: 'userB', email_verified: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isVerifiedOwner(userId)',
  },
  {
    id: 'DD-02',
    title: 'Unverified Email Write (Email Spoofing Test)',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: false },
    payload: { uid: 'userA', email: 'a@example.com' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isVerified() checks request.auth.token.email_verified == true',
  },
  {
    id: 'DD-03',
    title: 'Identity Spoofing on Job Create',
    operation: 'create',
    path: '/users/userA/jobs/job-1',
    auth: { uid: 'userA', email_verified: true },
    payload: { id: 'job-1', ownerId: 'userB' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidJob checks data.ownerId == request.auth.uid',
  },
  {
    id: 'DD-04',
    title: 'Shadow Field Injection on UserProfile Create',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: true },
    payload: { uid: 'userA', isAdmin: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidUserProfile enforces data.keys().hasOnly(...)',
  },
  {
    id: 'DD-05',
    title: 'Shadow Field Injection on Job Update',
    operation: 'update',
    path: '/users/userA/jobs/job-1',
    auth: { uid: 'userA', email_verified: true },
    payload: { notes: 'hello', verifiedByAdmin: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidJob + affectedKeys().hasOnly(...)',
  },
  {
    id: 'DD-06',
    title: 'Immutable createdAt Tampering',
    operation: 'update',
    path: '/users/userA/jobs/job-1',
    auth: { uid: 'userA', email_verified: true },
    payload: { createdAt: '1999-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().createdAt == existing().createdAt',
  },
  {
    id: 'DD-07',
    title: 'Client-Forged Timestamp on Rule Create',
    operation: 'create',
    path: '/users/userA/rules/rule-1',
    auth: { uid: 'userA', email_verified: true },
    payload: { id: 'rule-1', ownerId: 'userA', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'incoming().createdAt == request.time',
  },
  {
    id: 'DD-08',
    title: 'Path ID Poisoning Attack',
    operation: 'create',
    path: '/users/userA/jobs/bad$id..spaces',
    auth: { uid: 'userA', email_verified: true },
    payload: { id: 'bad$id..spaces', ownerId: 'userA' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidId(jobId) enforces ^[a-zA-Z0-9_\\-]+$ and <= 128 chars',
  },
  {
    id: 'DD-09',
    title: 'Array Overflow Attack on UserProfile Keywords',
    operation: 'update',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: true },
    payload: { keywords: Array.from({ length: 35 }, (_, i) => `kw-${i}`) },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isBoundedStringList(data.keywords, 30)',
  },
  {
    id: 'DD-10',
    title: 'Value Poisoning on Job Update (Out-of-Range Match Score)',
    operation: 'update',
    path: '/users/userA/jobs/job-1',
    auth: { uid: 'userA', email_verified: true },
    payload: { matchScore: 999 },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'isValidJob enforces matchScore >= 0 && matchScore <= 100',
  },
  {
    id: 'DD-11',
    title: 'Orphaned Subcollection Write Before Parent User Exists',
    operation: 'create',
    path: '/users/userOrphan/jobs/job-1',
    auth: { uid: 'userOrphan', email_verified: true },
    payload: { id: 'job-1', ownerId: 'userOrphan' },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'parentUserExists(userId)',
  },
  {
    id: 'DD-12',
    title: 'Blanket Users Collection Enumeration',
    operation: 'list',
    path: '/users',
    auth: { uid: 'userA', email_verified: true },
    expected: 'PERMISSION_DENIED',
    enforcedBy: 'allow list: if false on /users/{userId}',
  },
];
