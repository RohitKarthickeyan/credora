-- Postgres runs each cascade as its own statement, so a caregiver delete checks this FK before Evidence's cascade has run.
ALTER TABLE "core"."Evidence" ALTER CONSTRAINT "Evidence_signedDocumentId_fkey" DEFERRABLE INITIALLY DEFERRED;
