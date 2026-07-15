-- Migration: add sort_order column for manual drag-to-reorder
-- Run this in the Supabase SQL editor for project awccquoyscijmtqtibgr

alter table vibecheck_tasks
  add column if not exists sort_order float8;
