#!/usr/bin/env tsx
/**
 * Collect Usage Script
 * 
 * Collects current OpenClaw usage data and stores it in SQLite
 * Run manually or via cron
 */

import { collectUsage } from "../src/lib/usage-collector";

async function main() {
  console.log("🦞 Mission Control - Usage Collector (Supabase)");
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log();

  try {
    // No DB path needed any more — usage_snapshots_v1 lives in Supabase
    // and the helper reads the connection from env vars.
    await collectUsage();
    console.log("✅ Usage data collected successfully");
  } catch (error) {
    console.error("❌ Error collecting usage data:", error);
    process.exit(1);
  }
}

main();
