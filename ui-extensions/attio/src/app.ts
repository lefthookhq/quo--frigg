import type {App} from "attio"

import {helloWorldAction} from "./hello-world-action"
import {callInQuoAction} from "./call-in-quo-action"


export const app: App = {
    record: {
        actions: [helloWorldAction, callInQuoAction],
        bulkActions: [],
    },
}
