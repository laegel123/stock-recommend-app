CREATE TYPE "public"."change_type" AS ENUM('NEW', 'ADD', 'REDUCE', 'EXIT', 'HOLD');--> statement-breakpoint
CREATE TYPE "public"."cusip_confidence" AS ENUM('exact', 'fuzzy', 'manual');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('BUY', 'SELL', 'STAKE_NEW', 'STAKE_INCREASE', 'STAKE_DECREASE', 'STAKE_EXIT');--> statement-breakpoint
CREATE TYPE "public"."form_type" AS ENUM('13F-HR', '13F-HR/A', '4', 'SC 13D', 'SC 13G', '13D/A', '13G/A', 'majorstock', 'elestock');--> statement-breakpoint
CREATE TYPE "public"."intent" AS ENUM('active', 'passive');--> statement-breakpoint
CREATE TYPE "public"."investor_type" AS ENUM('us_13f_manager', 'kr_disclosure_filer');--> statement-breakpoint
CREATE TYPE "public"."market" AS ENUM('US', 'KR');--> statement-breakpoint
CREATE TYPE "public"."source" AS ENUM('edgar', 'dart');--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"investor_id" integer NOT NULL,
	"security_id" integer NOT NULL,
	"source" "source" NOT NULL,
	"form_type" "form_type" NOT NULL,
	"event_type" "event_type" NOT NULL,
	"event_date" date NOT NULL,
	"filing_date" date NOT NULL,
	"shares_delta" numeric(24, 6),
	"shares_after" numeric(24, 6),
	"pct_of_company_after" numeric(9, 4),
	"price_per_share" numeric(20, 6),
	"value" numeric(24, 2),
	"intent" "intent",
	"accession_number" text NOT NULL,
	"raw_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_events_investor_accession_security" UNIQUE("investor_id","accession_number","security_id")
);
--> statement-breakpoint
CREATE TABLE "benchmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"close" numeric(20, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_benchmarks_symbol_date" UNIQUE("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "consensus_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"security_id" integer NOT NULL,
	"quarter" text NOT NULL,
	"holders_count" integer DEFAULT 0 NOT NULL,
	"net_buyers_count" integer DEFAULT 0 NOT NULL,
	"new_buyers_count" integer DEFAULT 0 NOT NULL,
	"net_sellers_count" integer DEFAULT 0 NOT NULL,
	"recent_activity_count" integer DEFAULT 0 NOT NULL,
	"total_value_usd" numeric(24, 2),
	"score" numeric(12, 4) NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_consensus_security_quarter" UNIQUE("security_id","quarter")
);
--> statement-breakpoint
CREATE TABLE "corp_code_map" (
	"corp_code" text PRIMARY KEY NOT NULL,
	"stock_code" text,
	"security_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cusip_map" (
	"cusip" text PRIMARY KEY NOT NULL,
	"security_id" integer NOT NULL,
	"ticker" text,
	"confidence" "cusip_confidence" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "filings" (
	"id" serial PRIMARY KEY NOT NULL,
	"investor_id" integer NOT NULL,
	"source" "source" NOT NULL,
	"form_type" "form_type" NOT NULL,
	"quarter" text,
	"report_date" date,
	"filing_date" date NOT NULL,
	"accession_number" text NOT NULL,
	"raw_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_filings_investor_accession" UNIQUE("investor_id","accession_number")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"base" text DEFAULT 'USD' NOT NULL,
	"quote" text DEFAULT 'KRW' NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_fx_rates_date_pair" UNIQUE("date","base","quote")
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"filing_id" integer NOT NULL,
	"investor_id" integer NOT NULL,
	"security_id" integer NOT NULL,
	"quarter" text NOT NULL,
	"shares" numeric(24, 6) NOT NULL,
	"value_usd" numeric(24, 2),
	"pct_of_portfolio" numeric(9, 4),
	"put_call" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_holdings_filing_security" UNIQUE("filing_id","security_id")
);
--> statement-breakpoint
CREATE TABLE "investor_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"investor_id" integer NOT NULL,
	"security_id" integer,
	"quarter" text,
	"horizon" text NOT NULL,
	"position_return" numeric(9, 4),
	"benchmark_return" numeric(9, 4),
	"excess_return" numeric(9, 4),
	"win_rate" numeric(9, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investors" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"type" "investor_type" NOT NULL,
	"source" "source" NOT NULL,
	"external_id" text NOT NULL,
	"is_curated" boolean DEFAULT true NOT NULL,
	"parent_investor_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investors_slug_unique" UNIQUE("slug"),
	CONSTRAINT "uq_investors_source_external" UNIQUE("source","external_id")
);
--> statement-breakpoint
CREATE TABLE "position_changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"investor_id" integer NOT NULL,
	"security_id" integer NOT NULL,
	"quarter" text NOT NULL,
	"prev_quarter" text,
	"change_type" "change_type" NOT NULL,
	"shares_delta" numeric(24, 6),
	"value_delta_usd" numeric(24, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_changes_investor_security_quarter" UNIQUE("investor_id","security_id","quarter")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"security_id" integer NOT NULL,
	"date" date NOT NULL,
	"close" numeric(20, 6) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_prices_security_date" UNIQUE("security_id","date")
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"id" serial PRIMARY KEY NOT NULL,
	"cusip" text,
	"figi" text,
	"ticker" text,
	"name" text NOT NULL,
	"market" "market" NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"sector" text,
	"industry" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "securities_cusip_unique" UNIQUE("cusip")
);
--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consensus_scores" ADD CONSTRAINT "consensus_scores_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "corp_code_map" ADD CONSTRAINT "corp_code_map_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cusip_map" ADD CONSTRAINT "cusip_map_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filings" ADD CONSTRAINT "filings_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_filing_id_filings_id_fk" FOREIGN KEY ("filing_id") REFERENCES "public"."filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_performance" ADD CONSTRAINT "investor_performance_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_performance" ADD CONSTRAINT "investor_performance_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investors" ADD CONSTRAINT "investors_parent_investor_id_investors_id_fk" FOREIGN KEY ("parent_investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_changes" ADD CONSTRAINT "position_changes_investor_id_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."investors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "position_changes" ADD CONSTRAINT "position_changes_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_security_id_securities_id_fk" FOREIGN KEY ("security_id") REFERENCES "public"."securities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_events_filing_date" ON "activity_events" USING btree ("filing_date");--> statement-breakpoint
CREATE INDEX "idx_events_type_filing_date" ON "activity_events" USING btree ("event_type","filing_date");--> statement-breakpoint
CREATE INDEX "idx_events_security" ON "activity_events" USING btree ("security_id");--> statement-breakpoint
CREATE INDEX "idx_consensus_quarter_rank" ON "consensus_scores" USING btree ("quarter","rank");--> statement-breakpoint
CREATE INDEX "idx_filings_filing_date" ON "filings" USING btree ("filing_date");--> statement-breakpoint
CREATE INDEX "idx_filings_investor_form" ON "filings" USING btree ("investor_id","form_type");--> statement-breakpoint
CREATE INDEX "idx_holdings_investor_quarter" ON "holdings" USING btree ("investor_id","quarter");--> statement-breakpoint
CREATE INDEX "idx_holdings_security_quarter" ON "holdings" USING btree ("security_id","quarter");--> statement-breakpoint
CREATE INDEX "idx_performance_investor" ON "investor_performance" USING btree ("investor_id");--> statement-breakpoint
CREATE INDEX "idx_changes_security_quarter" ON "position_changes" USING btree ("security_id","quarter");--> statement-breakpoint
CREATE INDEX "idx_securities_ticker" ON "securities" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "idx_securities_market" ON "securities" USING btree ("market");