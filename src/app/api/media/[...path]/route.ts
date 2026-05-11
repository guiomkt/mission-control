import { NextRequest, NextResponse } from "next/server";
import { readFile, stat, realpath } from "fs/promises";
import path from "path";
import { isPathAllowed } from "@/lib/paths";

/**
 * Serve images from the OpenClaw workspace or media directories.
 *
 * Hardening (V1):
 *  - Path goes through isPathAllowed against ALLOWED_BASES (from lib/paths)
 *  - realpath() resolves symlinks; rejected if they escape the allowed bases
 *  - Only image extensions returned, with explicit Content-Type
 */

const ALLOWED_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  // Reject path traversal in URL segments before resolving.
  if (segments.some((seg) => seg === ".." || seg === "" || seg.includes("\0"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Build absolute path then normalize. Reject if it isn't under an allowed base.
  const candidate = path.resolve("/" + segments.join("/"));
  if (!isPathAllowed(candidate)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ext = path.extname(candidate).toLowerCase();
  const contentType = ALLOWED_EXTENSIONS[ext];
  if (!contentType) {
    return NextResponse.json({ error: "Not an image" }, { status: 403 });
  }

  try {
    const real = await realpath(candidate);
    // Symlink protection: confirm the resolved real path is still under an allowed base.
    if (!isPathAllowed(real)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const fileStat = await stat(real);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const data = await readFile(real);
    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
