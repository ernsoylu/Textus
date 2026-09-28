-- Storage buckets and policies. Source: ARCHITECTURE_AND_REQUIREMENTS.md §7.4
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
    ('documents', 'documents', FALSE, 524288000, ARRAY[
        'application/pdf', 'application/epub+zip', 'application/x-mobipocket-ebook',
        'application/vnd.amazon.ebook', 'application/vnd.comicbook+zip', 'text/html', 'text/plain']),
    ('covers', 'covers', FALSE, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp']),
    ('staging', 'staging', FALSE, 524288000, NULL) -- type is detected server-side after upload
ON CONFLICT (id) DO NOTHING;

-- Clients read their own files (needed to create signed URLs with the user's JWT).
CREATE POLICY "documents_select_own" ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'documents' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
CREATE POLICY "covers_select_own" ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'covers' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
);
-- No client INSERT/UPDATE/DELETE on any bucket:
--   staging  → clients upload through server-issued signed upload URLs
--   documents/covers → written and deleted only by Edge Functions
