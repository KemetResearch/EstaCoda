import type { ParsedKeypress } from "../../input/parseKeypress.js";
import type {
  ActiveWorkItem,
  StatusRailState,
} from "./operatorConsoleState.js";

export type ApprovalRequestViewModel = {
  readonly id: string;
  readonly title: string;
  readonly action: string;
  readonly target?: string;
  readonly risk?: string;
};

export type OperatorConsoleEvent =
  | { readonly type: "key"; readonly key: ParsedKeypress }
  | { readonly type: "paste"; readonly text: string }
  | { readonly type: "resize"; readonly width: number; readonly height: number }
  | { readonly type: "toolEvent"; readonly event: ActiveWorkItem }
  | { readonly type: "approvalRequested"; readonly request: ApprovalRequestViewModel }
  | { readonly type: "turnStarted" }
  | { readonly type: "turnCompleted" }
  | { readonly type: "statusChanged"; readonly status: StatusRailState };
