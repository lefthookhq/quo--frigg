import type {App} from "attio"
import {runQuery, showToast} from "attio/client"
import getPhoneNumber from "./get-phone-number.graphql"

export const callInQuoAction: App.Record.Action = {
    id: "call-in-quo",
    label: "Call in Quo",
    objects: ["people", "companies"],
    onTrigger: async ({recordId, object}: {recordId: string, object: string}) => {
        // Get the record data to access the phone number using GraphQL
        const result = (await runQuery(getPhoneNumber, {recordId, object})) as {
            object: {
                attributes: Array<{slug: string, title: string, type: string}>
            }
            record: {
                attribute: {
                    value?: string
                    values?: string[]
                }
            }
        }
        
        console.log("Record data:", JSON.stringify(result, null, 2))
        
        const record = result?.record
        
        // Extract phone number from the record - handle both single value and array
        const phoneNumber = record?.attribute?.value 
            || record?.attribute?.values?.[0]
        
        if (!phoneNumber) {
            showToast({
                variant: "error",
                title: "No phone number found",
            })
            return
        }
        
        // Use tel: protocol to launch Quo desktop app
        // The tel: URL scheme will be handled by the Quo desktop app
        window.open(`tel:${phoneNumber}`, '_self')
    },
}

