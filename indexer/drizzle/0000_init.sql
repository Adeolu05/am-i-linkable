CREATE TABLE "event_addresses" (
	"txid" text NOT NULL,
	"pool" text NOT NULL,
	"role" text NOT NULL,
	"address" text NOT NULL,
	"address_type" text NOT NULL,
	"amount_zat" bigint NOT NULL,
	"address_hash" "bytea" NOT NULL,
	CONSTRAINT "event_addresses_pk" PRIMARY KEY("txid","pool","role","address"),
	CONSTRAINT "event_addresses_role_check" CHECK ("event_addresses"."role" in ('input', 'output')),
	CONSTRAINT "event_addresses_type_check" CHECK ("event_addresses"."address_type" in ('transparent', 'nonstandard-script'))
);
--> statement-breakpoint
CREATE TABLE "indexed_blocks" (
	"height" integer PRIMARY KEY NOT NULL,
	"hash" text,
	"time" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "indexed_blocks_source_check" CHECK ("indexed_blocks"."source" in ('dump', 'api'))
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pool_migrations" (
	"txid" text PRIMARY KEY NOT NULL,
	"height" integer NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"from_pools" jsonb NOT NULL,
	"to_pools" jsonb NOT NULL,
	"fee_zat" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turnstile_events" (
	"txid" text NOT NULL,
	"pool" text NOT NULL,
	"height" integer NOT NULL,
	"time" timestamp with time zone NOT NULL,
	"direction" text NOT NULL,
	"amount_zat" bigint NOT NULL,
	"fee_zat" bigint NOT NULL,
	"is_dust" boolean NOT NULL,
	CONSTRAINT "turnstile_events_pk" PRIMARY KEY("txid","pool"),
	CONSTRAINT "turnstile_events_pool_check" CHECK ("turnstile_events"."pool" in ('sprout', 'sapling', 'orchard', 'ironwood')),
	CONSTRAINT "turnstile_events_direction_check" CHECK ("turnstile_events"."direction" in ('shield', 'unshield'))
);
--> statement-breakpoint
ALTER TABLE "event_addresses" ADD CONSTRAINT "event_addresses_event_fk" FOREIGN KEY ("txid","pool") REFERENCES "public"."turnstile_events"("txid","pool") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_migrations" ADD CONSTRAINT "pool_migrations_height_indexed_blocks_height_fk" FOREIGN KEY ("height") REFERENCES "public"."indexed_blocks"("height") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turnstile_events" ADD CONSTRAINT "turnstile_events_height_indexed_blocks_height_fk" FOREIGN KEY ("height") REFERENCES "public"."indexed_blocks"("height") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_addresses_hash_idx" ON "event_addresses" USING btree ("address_hash");--> statement-breakpoint
CREATE INDEX "indexed_blocks_time_idx" ON "indexed_blocks" USING btree ("time");--> statement-breakpoint
CREATE INDEX "pool_migrations_time_idx" ON "pool_migrations" USING btree ("time");--> statement-breakpoint
CREATE INDEX "pool_migrations_height_idx" ON "pool_migrations" USING btree ("height");--> statement-breakpoint
CREATE INDEX "turnstile_events_time_idx" ON "turnstile_events" USING btree ("time");--> statement-breakpoint
CREATE INDEX "turnstile_events_height_idx" ON "turnstile_events" USING btree ("height");--> statement-breakpoint
CREATE INDEX "turnstile_events_amount_idx" ON "turnstile_events" USING btree ("amount_zat");