import type { TaskState, TaskStatus, TeammateState } from "../types.js";
import type { TeamsStore } from "./types.js";
import {
  getTask,
  listTasks,
  loadTeammate,
  listTeammates,
  removeTeammate,
  targetExists,
  teammateExists,
} from "../store.js";

export class FilesystemTeamsStore implements TeamsStore {
  async teammateExists(name: string): Promise<boolean> {
    return teammateExists(name);
  }

  async targetExists(name: string): Promise<boolean> {
    return targetExists(name);
  }

  async loadTeammate(name: string): Promise<TeammateState | null> {
    return loadTeammate(name);
  }

  async listTeammates(): Promise<TeammateState[]> {
    return listTeammates();
  }

  async removeTeammate(name: string): Promise<boolean> {
    return removeTeammate(name);
  }

  async getTask(id: string): Promise<TaskState | null> {
    return getTask(id);
  }

  async listTasks(status?: TaskStatus): Promise<TaskState[]> {
    return listTasks(status);
  }
}

export function createFilesystemTeamsStore(): TeamsStore {
  return new FilesystemTeamsStore();
}
