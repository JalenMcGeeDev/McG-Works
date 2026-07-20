-- Migration: add description column to vibecheck_tasks
-- Run this in the Supabase SQL editor for project awccquoyscijmtqtibgr

alter table vibecheck_tasks
  add column if not exists description text;
