import type { Trajectory } from "./trajectory.js";

export type TrajectoryStore = {
  saveTrajectory(trajectory: Trajectory): Promise<void>;
  loadTrajectory(id: string): Promise<Trajectory | undefined>;
  listTrajectoriesForSession(sessionId: string): Promise<Trajectory[]>;
  listTrajectoriesForProfile(
    profileId: string,
    options?: { limit?: number; after?: string }
  ): Promise<Trajectory[]>;
};
