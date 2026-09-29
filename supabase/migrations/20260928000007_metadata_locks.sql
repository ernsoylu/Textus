-- FR-META-3: works and records keep the list of fields explicitly edited by the user.
ALTER TABLE public.works ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';
