# Meridian Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Strict Account Ownership & PII Isolation**: `/users/{userId}` contains private PII (`email`, `displayName`, personal job search criteria). Read and write access is strictly limited to the verified owner (`request.auth.uid == userId && request.auth.token.email_verified == true`). No blanket `list` on `/users`.
2. **Parent Existence (Master Gate)**: All subcollection documents (`/jobs`, `/sources`, `/rules`, `/feedback`, `/events`, `/imports`) require the parent `/users/{userId}` document to exist on create, and every subcollection document MUST store `ownerId == request.auth.uid == userId`.
3. **Immutable Ownership & Timestamps**: `uid`, `ownerId`, and `createdAt` can NEVER be modified after creation. `createdAt == request.time` on create; `updatedAt == request.time` on create and update.
4. **Strict Keys & Anti-Shadow Fields**: Every `create` checks `keys().hasAll(...)` and `keys().hasOnly(...)`. Every `update` calls `isValid[Entity](incoming())` AND uses action-based `incoming().diff(existing()).affectedKeys().hasOnly(...)`.
5. **Bounded Strings, Arrays & Path IDs**: All document IDs pass `isValidId()` (`^[a-zA-Z0-9_\-]+$`, max 128 chars). Every string enforces `.size() <= MAX`. Every array enforces `.size() <= MAX` and checks element 0 type when non-empty.
6. **Secure List Queries**: `allow list` on subcollections verifies `isVerifiedOwner(userId) && resource.data.ownerId == request.auth.uid` without calling `get()` or `exists()`.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Cross-Tenant Profile Read**: Authenticated User B attempts `get` on `/users/userA`.
2. **Unverified Email Write**: Authenticated user with `email_verified: false` attempts to create `/users/userA`.
3. **Identity Spoofing on Job Create**: User A attempts to create `/users/userA/jobs/job-1` with `ownerId: "userB"`.
4. **Shadow Field Injection (UserProfile)**: User A creates `/users/userA` with extra field `isAdmin: true`.
5. **Shadow Field Injection (Job Update)**: User A updates `/users/userA/jobs/job-1` adding ghost key `verifiedByAdmin: true`.
6. **Immutable `createdAt` Tampering**: User A updates `/users/userA/jobs/job-1` modifying `createdAt`.
7. **Client-Forged Timestamp on Create**: User A creates `/users/userA/rules/rule-1` with a past client timestamp instead of `request.time`.
8. **ID Poisoning Attack**: User A attempts to create `/users/userA/jobs/bad$id..with..spaces` (invalid chars or >128 chars).
9. **Array Overflow Attack**: User A updates `/users/userA` with `keywords` containing 35 strings (exceeds max 30).
10. **Value Poisoning on Update**: User A updates `/users/userA/jobs/job-1` setting `matchScore: 999` or `stage: "hacked"`.
11. **Orphaned Subcollection Write**: User A attempts to create `/users/userA/jobs/job-1` before `/users/userA` exists.
12. **Blanket Users Collection Enumeration**: Authenticated User A attempts `list` on `/users`.
