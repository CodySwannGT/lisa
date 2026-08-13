-- Fixture migration for the state-classification detector. Not executed anywhere.
CREATE TABLE public.user_cards (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS public.notes (id uuid PRIMARY KEY);
CREATE TABLE public.watchlists (id uuid PRIMARY KEY);
CREATE TABLE public.cards (id uuid PRIMARY KEY);
CREATE TABLE public.onboarding_options (id uuid PRIMARY KEY);
CREATE TABLE ledger.payments (id uuid PRIMARY KEY);
CREATE MATERIALIZED VIEW analytics.player_season_rollup AS SELECT 1;
CREATE TABLE public.saved_searches (id uuid PRIMARY KEY);
