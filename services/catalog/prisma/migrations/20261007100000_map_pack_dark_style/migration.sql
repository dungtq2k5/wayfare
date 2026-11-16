-- AlterTable: the dark flavour's style, nullable so packs built before it keep working (light only).
ALTER TABLE "map_packs" ADD COLUMN "dark_style_object_path" VARCHAR(512);
