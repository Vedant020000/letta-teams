import type { TaskState, TaskStatus, TeammateState } from "../types.js";

export interface TeamsStore {
  teammateExists(name: string): Promise<boolean>;
  targetExists(name: string): Promise<boolean>;
  loadTeammate(name: string): Promise<TeammateState | null>;
  listTeammates(): Promise<TeammateState[]>;
  removeTeammate(name: string): Promise<boolean>;

  getTask(id: string): Promise<TaskState | null>;
  listTasks(status?: TaskStatus): Promise<TaskState[]>;
}
