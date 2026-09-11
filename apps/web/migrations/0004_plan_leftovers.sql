-- A leftovers night keeps its recipe_id, so the week still shows the photo and
-- taps through to what you're reheating. The flag is what stops it being
-- cooked twice: `mergedPlanItems` skips these rows, or a curry planned Thursday
-- with leftovers Friday would put every ingredient on the list twice.
ALTER TABLE plan_entries ADD COLUMN leftovers INTEGER NOT NULL DEFAULT 0;
