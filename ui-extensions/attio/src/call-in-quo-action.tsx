import type {App} from "attio"
import {runQuery, showToast, showDialog, Link} from "attio/client"
import getPhoneNumber from "./get-phone-number.graphql"

export const callInQuoAction: App.Record.Action = {
    id: "call-in-quo",
    label: "Call in Quo",
    objects: ["people", "companies"], // Specify which object types this action applies to
    onTrigger: async ({recordId, object}) => {
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
        
        // Show a dialog with a clickable phone link
        showDialog({
            title: "Call in Quo",
            Dialog: () => {
                return (
                    <Link href={`tel:${phoneNumber}`}>
                        Call {phoneNumber}
                    </Link>
                )
            },
        })
    },
}

