/**
 * Store module - barrel export for all storage operations
 *
 * Re-exports from:
 * - auth.ts: Auth token management (global, in home directory)
 * - teammate.ts: Teammate CRUD operations
 * - todo.ts: TODO and status event management
 * - task.ts: Task storage operations
 */

// ═══════════════════════════════════════════════════════════════
// AUTH EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  AuthToken,
  getGlobalAuthDir,
  ensureGlobalAuthDir,
  getAuthPath,
  hasAuthToken,
  loadAuthToken,
  getApiKey,
  saveAuthToken,
  clearAuthToken,
  promptForApiKey,
} from "./auth.js";

// ═══════════════════════════════════════════════════════════════
// TEAMMATE EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  setProjectDir,
  getProjectDir,
  getLteamsDir,
  ensureLteamsDir,
  getTeammatePath,
  teammateExists,
  loadTeammate,
  saveTeammate,
  getRootConversationId,
  getConversationTarget,
  listConversationTargets,
  getMemoryTarget,
  getMemoryConversationId,
  targetExists,
  createConversationTarget,
  updateConversationTarget,
  updateTeammate,
  removeTeammate,
  listTeammates,
} from "./teammate.js";

// ═══════════════════════════════════════════════════════════════
// TODO & STATUS EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  UpdateStatusSummaryInput,
  updateStatus,
  setError,
  addTodo,
  listTodoItems,
  startTodo,
  blockTodo,
  unblockTodo,
  completeTodo,
  dropTodo,
  updateStatusSummary,
  getRecentStatusEvents,
  findStaleTeammates,
} from "./todo.js";

// ═══════════════════════════════════════════════════════════════
// TASK EXPORTS
// ═══════════════════════════════════════════════════════════════

export {
  StaleRunningInitTask,
  getTasksPath,
  loadTasks,
  saveTasks,
  getTask,
  createTask,
  updateTask,
  listTasks,
  listRecentTasks,
  cleanupOldTasks,
  findTasksToPrune,
  deleteTasks,
  findIdleTeammates,
  findBrokenTeammates,
  deleteTeammates,
  findStaleRunningInitTasks,
} from "./task.js";
