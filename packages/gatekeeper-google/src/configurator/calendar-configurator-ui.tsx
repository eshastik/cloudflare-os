import { Autocomplete, Field, h, RadioCards, Section, type ConfiguratorUISpec } from "@gadgets/configurator-ui";
import type { CalendarConfiguratorRpc, CalendarConfiguratorValues } from "./calendar-configurator-types";

export default {
  initial: { availabilityMode: "thisCalendar", accessMode: "read" },

  isReady({ values }) {
    return typeof values.calendarId === "string" && values.calendarId.length > 0;
  },

  resourceUrl({ values }) {
    const calendarId = encodeURIComponent(values.calendarId ?? "");
    const availabilityMode = values.availabilityMode === "allVisible" ? "allVisible" : "thisCalendar";
    return `https://calendar.google.com/calendar/${calendarId}/?availability=${availabilityMode}&access=${values.accessMode === "manage" ? "manage" : "read"}`;
  },

  render({ values, setValues, ui }) {
    const availabilityMode = values.availabilityMode === "allVisible" ? "allVisible" : "thisCalendar";
    return <Section>
      <Field label="Calendar" description="Choose a calendar your account can read.">
        <Autocomplete
          name="calendarId"
          value={values.calendarId}
          placeholder="Search calendars..."
          loadOptions={query => ui.listCalendars(query)}
          onChange={calendarId => setValues({ calendarId })}
        />
      </Field>

      <Field label="Calendar access" description="Choose whether this connection can propose changes.">
        <RadioCards value={values.accessMode === "manage" ? "manage" : "read"}
          options={[
            {value:"read", title:"Read only", description:"Read events and availability without changing the calendar."},
            {value:"manage", title:"Read and manage", description:"Propose changes for approval; Google Calendar permissions still apply."},
          ]}
          onChange={mode=>{if(mode==="read"||mode==="manage")setValues({accessMode:mode});}}
        />
      </Field>

      <Field
        label="Availability lookup"
        description="Free/busy checks show only busy/free blocks, never event details."
      >
        <RadioCards
          value={availabilityMode}
          options={[
            {
              value: "thisCalendar",
              title: "This calendar only",
              description: "Check availability for this calendar only.",
            },
            {
              value: "allVisible",
              title: "All calendars visible to me",
              description: "Check anyone visible to your account. Collaborators must also be able to see their availability.",
            },
          ]}
          onChange={nextMode => {
            if (nextMode !== "thisCalendar" && nextMode !== "allVisible") return;
            setValues({ availabilityMode: nextMode });
          }}
        />
      </Field>
    </Section>;
  },
} satisfies ConfiguratorUISpec<CalendarConfiguratorRpc, CalendarConfiguratorValues>;
