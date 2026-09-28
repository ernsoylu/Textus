import type { Database } from './database';

type Tables = Database['public']['Tables'];

export type WorkRow = Tables['works']['Row'];
export type RecordRow = Tables['records']['Row'];
export type IdentifierRow = Tables['identifiers']['Row'];
export type ContributorRow = Tables['contributors']['Row'];
export type ContributorNameRow = Tables['contributor_names']['Row'];
export type ContributorIdentifierRow = Tables['contributor_identifiers']['Row'];
export type RecordContributorRow = Tables['record_contributors']['Row'];
export type AssetRow = Tables['assets']['Row'];
export type RecordAssetRow = Tables['record_assets']['Row'];
export type TagRow = Tables['tags']['Row'];
export type CollectionRow = Tables['collections']['Row'];
export type ReadingStateRow = Tables['reading_states']['Row'];
export type AnnotationRow = Tables['annotations']['Row'];
export type JobRow = Tables['jobs']['Row'];
