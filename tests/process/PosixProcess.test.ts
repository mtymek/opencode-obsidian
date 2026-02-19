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
      // Use a binary that exists on most Unix systems
      const existingBinary = "/bin/ls";
      const result = await processImpl.verifyCommand(existingBinary);
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
      // When file exists but is not executable, should return helpful chmod message
      expect(result).toContain("not executable");
      expect(result).toContain("chmod +x");
    });
  });
});
