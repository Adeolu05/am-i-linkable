CREATE TABLE "snapshots" (
	"key" text PRIMARY KEY NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"tip_height" integer,
	"etag" text NOT NULL,
	"row_count" integer NOT NULL,
	"json_bytes" integer NOT NULL,
	"body_gzip" "bytea" NOT NULL,
	"body_br" "bytea"
);
