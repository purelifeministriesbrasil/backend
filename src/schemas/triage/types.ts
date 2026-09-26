import { z } from "zod";
import { triageSubmissionSchema } from "./schema.js";

export type TriageSubmission = z.infer<typeof triageSubmissionSchema>;
export type TriageProgramInterest = TriageSubmission["programInterest"];
export type TriageProfile = TriageSubmission["profile"];
export type TriageContactChannel = TriageSubmission["contactChannel"];
