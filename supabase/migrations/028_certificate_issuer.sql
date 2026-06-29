-- Record who issued each certificate.
--
-- Verification can already show the department's Teaching Lead (departments.lead_name),
-- but until now nothing captured the moderator who actually generated the
-- certificate. We snapshot the issuer's display name on the row (alongside the
-- existing recipient_name snapshot) so verification and the PDF stay stable even
-- if the account/name later changes. issued_by keeps the auth user id for audit.
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS issued_by UUID REFERENCES auth.users(id);
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS issued_by_name TEXT;
