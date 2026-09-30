-- DjVu documents (FR-FILE-1, FR-READ-6) and tags on notes and collections (FR-ORG-1): one tag can label
-- records, collections and annotations alike.
BEGIN;

ALTER TABLE public.assets DROP CONSTRAINT assets_file_format_check;
ALTER TABLE public.assets ADD CONSTRAINT assets_file_format_check
    CHECK (file_format IN ('pdf', 'epub', 'mobi', 'azw3', 'cbz', 'djvu', 'html', 'txt', 'image'));

UPDATE storage.buckets SET allowed_mime_types = ARRAY[
    'application/pdf', 'application/epub+zip', 'application/x-mobipocket-ebook',
    'application/vnd.amazon.ebook', 'application/vnd.comicbook+zip', 'image/vnd.djvu', 'text/html', 'text/plain']
WHERE id = 'documents';

CREATE TABLE public.annotation_tags (
    annotation_id UUID NOT NULL REFERENCES public.annotations(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (annotation_id, tag_id)
);
CREATE INDEX idx_annotation_tags_tag ON public.annotation_tags(tag_id);

CREATE TABLE public.collection_tags (
    collection_id UUID NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
    tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (collection_id, tag_id)
);
CREATE INDEX idx_collection_tags_tag ON public.collection_tags(tag_id);

-- Junctions: rows are visible and removable when the labelled item is the caller's; inserting also needs the
-- tag to be theirs (CLAUDE.md invariant 4). No UPDATE policy: a junction row is replaced, never edited.
ALTER TABLE public.annotation_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "annotation_tags_select" ON public.annotation_tags FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.annotations a WHERE a.id = annotation_id AND a.user_id = (SELECT auth.uid()))
);
CREATE POLICY "annotation_tags_insert" ON public.annotation_tags FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.annotations a WHERE a.id = annotation_id AND a.user_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.tags t WHERE t.id = tag_id AND t.user_id = (SELECT auth.uid()))
);
CREATE POLICY "annotation_tags_delete" ON public.annotation_tags FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.annotations a WHERE a.id = annotation_id AND a.user_id = (SELECT auth.uid()))
);

ALTER TABLE public.collection_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collection_tags_select" ON public.collection_tags FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
);
CREATE POLICY "collection_tags_insert" ON public.collection_tags FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
    AND EXISTS (SELECT 1 FROM public.tags t WHERE t.id = tag_id AND t.user_id = (SELECT auth.uid()))
);
CREATE POLICY "collection_tags_delete" ON public.collection_tags FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.collections c WHERE c.id = collection_id AND c.user_id = (SELECT auth.uid()))
);

NOTIFY pgrst, 'reload schema';
COMMIT;
