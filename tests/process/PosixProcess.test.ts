import { describe, test, expect } from "bun:test";
import { PosixProcess } from "../../src/server/process/PosixProcess";

describe.skipIf(process.platform === "win32")("PosixProcess", () => {
  const processImpl = new PosixProcess();

  describe("verifyCommand", () => {
    test("returns null for non-absolute commands", async () => {
      // Non-absolute paths should return null (let spawn handle it)
      const result = await processImpl.verifyCommand("ls");
      expect(result).toBeNull();
    });

    test("returns null for existing absolute path", async () => {
      // /bin/ls should exist on most POSIX systems
      const result = await processImpl.verifyCommand("/bin/ls");
      expect(result).toBeNull();
    });

    test("returns error message for non-existent absolute path", async () => {
      const nonExistentPath = "/nonexistent/path/to/executable";
      const result = await processImpl.verifyCommand(nonExistentPath);
      expect(result).toContain("Executable not found");
      expect(result).toContain(nonExistentPath);
    });

    test("returns error for non-executable file", async () => {
      // Test with a regular file that's not executable
      const result = await processImpl.verifyCommand("/etc/passwd");
      expect(result).toContain("Executable not found");
    });
  });
});
