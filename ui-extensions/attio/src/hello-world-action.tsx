import type {App} from "attio"
import {showDialog} from "attio/client"

import {HelloWorldDialog} from "./hello-world-dialog"

export const helloWorldAction: App.Record.Action = {
    id: "quo-test",
    label: "Quo-test",
    onTrigger: async ({recordId}) => {
        showDialog({
            title: "Quo-test",
            Dialog: () => {
                // This is a React component. It can use hooks and render other components.
                return <HelloWorldDialog recordId={recordId} />
            },
        })
    },
}
