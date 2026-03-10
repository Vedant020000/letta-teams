import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  saveTeammate,
  loadTeammate,
  teammateExists,
  removeTeammate,
  listTeammates,
  updateStatus,
  updateProgress,
  updateWork,
  updateTeammate,
  reportProblem,
  clearProblem,
  markDone,
  addPendingTask,
  completeTask,
  createTask,
  updateTask,
  getTask,
  listTasks,
  listRecentTasks,
  deleteTasks,
  findTasksToPrune,
  cleanupOldTasks,
  findIdleTeammates,
  findBrokenTeammates,
  deleteTeammates,
  setProjectDir,
  getProjectDir,
  getLteamsDir,
  ensureLteamsDir,
  getTeammatePath,
} from "./store.js";
import type { TeammateState } from "./types.js";

describe("Store Module", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "letta-teams-test-"));
    setProjectDir(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ═══════════════════════════════════════════════════════════════
  // PROJECT DIRECTORY TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Project Directory", () => {
    it("should return overridden project directory", () => {
      setProjectDir(tempDir);
      expect(getProjectDir()).toBe(tempDir);
    });

    it("should get .lteams directory path", () => {
      setProjectDir(tempDir);
      const lteamsDir = getLteamsDir();
      expect(lteamsDir).toBe(path.join(tempDir, ".lteams"));
    });

    it("should ensure .lteams directory exists", () => {
      setProjectDir(tempDir);
      ensureLteamsDir();
      expect(fs.existsSync(getLteamsDir())).toBe(true);
    });

    it("should get teammate path", () => {
      setProjectDir(tempDir);
      const teammatePath = getTeammatePath("alice");
      expect(teammatePath).toBe(path.join(tempDir, ".lteams", "alice.json"));
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TEAMMATE STORAGE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Teammate Storage", () => {
    const mockTeammate: TeammateState = {
      name: "test-agent",
      role: "Test role",
      agentId: "agent-123",
      conversationId: "conv-123",
      status: "idle",
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    it("should save a teammate", () => {
      saveTeammate(mockTeammate);
      expect(teammateExists("test-agent")).toBe(true);
    });

    it("should load a teammate", () => {
      saveTeammate(mockTeammate);
      const loaded = loadTeammate("test-agent");
      expect(loaded).toEqual(mockTeammate);
    });

    it("should return null for non-existent teammate", () => {
      const loaded = loadTeammate("nonexistent");
      expect(loaded).toBeNull();
    });

    it("should remove a teammate", () => {
      saveTeammate(mockTeammate);
      expect(teammateExists("test-agent")).toBe(true);
      const result = removeTeammate("test-agent");
      expect(result).toBe(true);
      expect(teammateExists("test-agent")).toBe(false);
    });

    it("should return false when removing non-existent teammate", () => {
      const result = removeTeammate("nonexistent");
      expect(result).toBe(false);
    });

    it("should list all teammates", () => {
      saveTeammate(mockTeammate);
      saveTeammate({ ...mockTeammate, name: "agent-2", agentId: "agent-456" });
      const list = listTeammates();
      expect(list).toHaveLength(2);
      expect(list.map(t => t.name)).toContain("test-agent");
      expect(list.map(t => t.name)).toContain("agent-2");
    });

    it("should return empty array when no teammates", () => {
      const list = listTeammates();
      expect(list).toEqual([]);
    });

    it("should handle corrupted JSON gracefully", () => {
      const lteamsDir = getLteamsDir();
      fs.mkdirSync(lteamsDir, { recursive: true });
      fs.writeFileSync(path.join(lteamsDir, "corrupt.json"), "not valid json");
      
      const loaded = loadTeammate("corrupt");
      expect(loaded).toBeNull();
    });

    it("should update teammate status", () => {
      saveTeammate(mockTeammate);
      const updated = updateStatus("test-agent", "working");
      expect(updated?.status).toBe("working");
      
      const loaded = loadTeammate("test-agent");
      expect(loaded?.status).toBe("working");
    });

    it("should update teammate with partial updates", () => {
      saveTeammate(mockTeammate);
      const updated = updateTeammate("test-agent", {
        model: "google_ai/gemini-2.5-flash",
        role: "Updated role",
      });
      
      expect(updated?.model).toBe("google_ai/gemini-2.5-flash");
      expect(updated?.role).toBe("Updated role");
    });

    it("should return null when updating non-existent teammate", () => {
      const result = updateTeammate("nonexistent", { status: "working" });
      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // PROGRESS & WORK TRACKING TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Progress & Work Tracking", () => {
    const mockTeammate: TeammateState = {
      name: "test-agent",
      role: "Test role",
      agentId: "agent-123",
      conversationId: "conv-123",
      status: "idle",
      lastUpdated: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    beforeEach(() => {
      saveTeammate(mockTeammate);
    });

    it("should update work with current task", () => {
      const updated = updateWork("test-agent", {
        currentTask: "Building feature X",
        progress: 50,
        progressNote: "Halfway done",
      });
      
      expect(updated?.currentTask).toBe("Building feature X");
      expect(updated?.progress).toBe(50);
      expect(updated?.progressNote).toBe("Halfway done");
      expect(updated?.status).toBe("working");
    });

    it("should update progress with task", () => {
      const updated = updateProgress("test-agent", {
        task: "New task",
        progress: 75,
      });
      
      expect(updated?.currentTask).toBe("New task");
      expect(updated?.progress).toBe(75);
    });

    it("should clamp progress to 0-100 range", () => {
      const updated1 = updateProgress("test-agent", { progress: 150 });
      expect(updated1?.progress).toBe(100);
      
      const updated2 = updateProgress("test-agent", { progress: -50 });
      expect(updated2?.progress).toBe(0);
    });

    it("should add pending task", () => {
      const updated = addPendingTask("test-agent", "Task 1");
      expect(updated?.pendingTasks).toContain("Task 1");
      expect(updated?.status).toBe("working");
    });

    it("should complete task and move to completed", () => {
      addPendingTask("test-agent", "Task 1");
      addPendingTask("test-agent", "Task 2");
      
      const updated = completeTask("test-agent", "Task 1");
      
      expect(updated?.completedTasks).toContain("Task 1");
      expect(updated?.pendingTasks).not.toContain("Task 1");
    });

    it("should report problem", () => {
      const updated = reportProblem("test-agent", "Blocked on API");
      
      expect(updated?.currentProblem).toBe("Blocked on API");
      expect(updated?.status).toBe("error");
    });

    it("should clear problem", () => {
      reportProblem("test-agent", "Blocked");
      const updated = clearProblem("test-agent");
      
      expect(updated?.currentProblem).toBeUndefined();
      expect(updated?.status).toBe("working");
    });

    it("should mark as done", () => {
      const updated = markDone("test-agent");
      
      expect(updated?.status).toBe("done");
      expect(updated?.progress).toBe(100);
      expect(updated?.currentTask).toBeUndefined();
      expect(updated?.currentProblem).toBeUndefined();
    });

    it("should handle done flag in updateProgress", () => {
      const updated = updateProgress("test-agent", { done: true });
      
      expect(updated?.status).toBe("done");
      expect(updated?.progress).toBe(100);
    });

    it("should handle problem flag in updateProgress", () => {
      const updated = updateProgress("test-agent", { problem: "Stuck!" });
      
      expect(updated?.currentProblem).toBe("Stuck!");
      expect(updated?.status).toBe("error");
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TASK STORAGE TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Task Storage", () => {
    it("should create a task", () => {
      const task = createTask("test-agent", "Do something");
      
      expect(task.id).toMatch(/^task-/);
      expect(task.teammateName).toBe("test-agent");
      expect(task.message).toBe("Do something");
      expect(task.status).toBe("pending");
      expect(task.createdAt).toBeDefined();
    });

    it("should get a task by ID", () => {
      const created = createTask("test-agent", "Task");
      const loaded = getTask(created.id);
      
      expect(loaded).toEqual(created);
    });

    it("should return null for non-existent task", () => {
      const task = getTask("nonexistent");
      expect(task).toBeNull();
    });

    it("should update a task", () => {
      const task = createTask("test-agent", "Task");
      const updated = updateTask(task.id, {
        status: "running",
        startedAt: new Date().toISOString(),
      });
      
      expect(updated?.status).toBe("running");
      expect(updated?.startedAt).toBeDefined();
    });

    it("should return null when updating non-existent task", () => {
      const result = updateTask("nonexistent", { status: "done" });
      expect(result).toBeNull();
    });

    it("should list all tasks", () => {
      createTask("agent-1", "Task 1");
      createTask("agent-2", "Task 2");
      
      const tasks = listTasks();
      expect(tasks).toHaveLength(2);
    });

    it("should list tasks by status", () => {
      const task1 = createTask("agent-1", "Task 1");
      createTask("agent-2", "Task 2");
      updateTask(task1.id, { status: "done", completedAt: new Date().toISOString() });
      
      const doneTasks = listTasks("done");
      expect(doneTasks).toHaveLength(1);
      
      const pendingTasks = listTasks("pending");
      expect(pendingTasks).toHaveLength(1);
    });

    it("should list recent tasks", () => {
      createTask("agent-1", "Task 1");
      createTask("agent-2", "Task 2");
      createTask("agent-3", "Task 3");
      
      const recent = listRecentTasks(2);
      expect(recent).toHaveLength(2);
    });

    it("should delete tasks", () => {
      const task1 = createTask("agent-1", "Task 1");
      const task2 = createTask("agent-2", "Task 2");
      
      const deleted = deleteTasks([task1.id, task2.id]);
      expect(deleted).toBe(2);
      
      expect(getTask(task1.id)).toBeNull();
      expect(getTask(task2.id)).toBeNull();
    });

    it("should find tasks to prune", () => {
      // Create an old completed task
      const oldTask = createTask("agent", "Old task");
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      updateTask(oldTask.id, {
        status: "done",
        completedAt: oldDate,
      });
      
      // Create a recent completed task
      const recentTask = createTask("agent", "Recent task");
      updateTask(recentTask.id, {
        status: "done",
        completedAt: new Date().toISOString(),
      });
      
      const toPrune = findTasksToPrune(7);
      expect(toPrune).toHaveLength(1);
      expect(toPrune[0].id).toBe(oldTask.id);
    });

    it("should cleanup old tasks", () => {
      const oldTask = createTask("agent", "Old task");
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      updateTask(oldTask.id, {
        status: "done",
        completedAt: oldDate,
      });
      
      const cleaned = cleanupOldTasks(7);
      expect(cleaned).toBe(1);
      expect(getTask(oldTask.id)).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TEAMMATE CLEANUP TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Teammate Cleanup", () => {
    it("should find idle teammates", () => {
      // Create an idle teammate (old lastUpdated)
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      saveTeammate({
        name: "idle-agent",
        role: "Test",
        agentId: "agent-1",
        status: "idle",
        lastUpdated: oldDate,
        createdAt: oldDate,
      });
      
      // Create an active teammate
      saveTeammate({
        name: "active-agent",
        role: "Test",
        agentId: "agent-2",
        status: "working",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      
      const idle = findIdleTeammates(7);
      expect(idle).toHaveLength(1);
      expect(idle[0].name).toBe("idle-agent");
    });

    it("should find broken teammates (no conversation ID)", () => {
      saveTeammate({
        name: "broken-agent",
        role: "Test",
        agentId: "agent-1",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      
      saveTeammate({
        name: "good-agent",
        role: "Test",
        agentId: "agent-2",
        conversationId: "conv-123",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      
      const broken = findBrokenTeammates();
      expect(broken).toHaveLength(1);
      expect(broken[0].name).toBe("broken-agent");
    });

    it("should delete teammates by name", () => {
      saveTeammate({
        name: "agent-1",
        role: "Test",
        agentId: "agent-1",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      
      saveTeammate({
        name: "agent-2",
        role: "Test",
        agentId: "agent-2",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      
      const deleted = deleteTeammates(["agent-1", "agent-2", "nonexistent"]);
      expect(deleted).toBe(2);
      expect(teammateExists("agent-1")).toBe(false);
      expect(teammateExists("agent-2")).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // MODEL-SPECIFIC TESTS
  // ═══════════════════════════════════════════════════════════════

  describe("Model-Specific Tests", () => {
    it("should save teammate with Gemini model", () => {
      const geminiTeammate: TeammateState = {
        name: "gemini-agent",
        role: "Fast responder",
        agentId: "gemini-agent-id",
        conversationId: "gemini-conv-id",
        model: "google_ai/gemini-2.5-flash",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      
      saveTeammate(geminiTeammate);
      const loaded = loadTeammate("gemini-agent");
      
      expect(loaded?.model).toBe("google_ai/gemini-2.5-flash");
    });

    it("should save teammate with GLM model", () => {
      const glmTeammate: TeammateState = {
        name: "glm-agent",
        role: "Chinese language specialist",
        agentId: "glm-agent-id",
        conversationId: "glm-conv-id",
        model: "zai/glm-5",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      
      saveTeammate(glmTeammate);
      const loaded = loadTeammate("glm-agent");
      
      expect(loaded?.model).toBe("zai/glm-5");
    });

    it("should update teammate model", () => {
      saveTeammate({
        name: "test-agent",
        role: "Test",
        agentId: "agent-1",
        status: "idle",
        lastUpdated: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });
      
      const updated = updateTeammate("test-agent", { model: "google_ai/gemini-2.5-flash" });
      expect(updated?.model).toBe("google_ai/gemini-2.5-flash");
    });
  });
});
