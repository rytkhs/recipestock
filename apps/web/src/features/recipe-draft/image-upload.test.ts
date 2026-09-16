import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadRecipeImage } from "./image-upload";

const createHeldUpload = () => {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });

  return { finish, finished };
};

const webpFile = (name: string) => new File(["image"], name, { type: "image/webp" });

// マイクロタスクとタイマーを一巡させ、待っているアップロードが始まらないことを見る。
const settlePendingWork = async () => {
  for (let round = 0; round < 3; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("uploadRecipeImage", () => {
  it("まとめて呼ばれても同時に走らせるのは3件までで、終わった順に次を始める", async () => {
    const heldUploads: ReturnType<typeof createHeldUpload>[] = [];
    let uploadUrlCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/images/upload-url") {
        uploadUrlCount += 1;

        return new Response(
          JSON.stringify({
            uploadUrl: `https://upload.example/${uploadUrlCount}`,
            objectKey: `tmp/user_123/image-${uploadUrlCount}.webp`,
            expiresAt: "2026-05-31T00:15:00.000Z",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      const heldUpload = createHeldUpload();
      heldUploads.push(heldUpload);
      await heldUpload.finished;

      return new Response(null, { status: 200 });
    });

    const uploads = Array.from({ length: 6 }, (_, index) =>
      uploadRecipeImage(webpFile(`image-${index}.webp`)),
    );

    await vi.waitFor(() => {
      expect(heldUploads).toHaveLength(3);
    });
    await settlePendingWork();
    expect(heldUploads).toHaveLength(3);
    expect(uploadUrlCount).toBe(3);

    heldUploads[0].finish();
    await vi.waitFor(() => {
      expect(heldUploads).toHaveLength(4);
    });
    await settlePendingWork();
    expect(heldUploads).toHaveLength(4);

    for (const heldUpload of heldUploads) {
      heldUpload.finish();
    }
    await vi.waitFor(() => {
      expect(heldUploads).toHaveLength(6);
    });
    for (const heldUpload of heldUploads) {
      heldUpload.finish();
    }

    await expect(Promise.all(uploads)).resolves.toHaveLength(6);
    expect(uploadUrlCount).toBe(6);
  });

  it("失敗した1件が枠を持ったままにならず、待っている次の1件が始まる", async () => {
    let uploadUrlCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/images/upload-url") {
        uploadUrlCount += 1;

        return new Response(
          JSON.stringify({
            uploadUrl: `https://upload.example/${uploadUrlCount}`,
            objectKey: `tmp/user_123/image-${uploadUrlCount}.webp`,
            expiresAt: "2026-05-31T00:15:00.000Z",
          }),
          { headers: { "content-type": "application/json" } },
        );
      }

      return new Response(null, { status: 500 });
    });

    const uploads = Array.from({ length: 6 }, (_, index) =>
      uploadRecipeImage(webpFile(`image-${index}.webp`)),
    );

    const results = await Promise.allSettled(uploads);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(uploadUrlCount).toBe(6);
  });
});
