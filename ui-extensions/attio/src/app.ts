import type { App } from "attio"
import { callInQuoAction } from "./call-in-quo-action"


export const app: App = {
    record: {
        actions: [callInQuoAction],
        bulkActions: [],
    },
}
