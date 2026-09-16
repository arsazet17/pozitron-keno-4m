#!/usr/bin/env python3
"""Live FULL20 runner.

Keeps the proven Stoloto parser/login logic, but supplies the complete KENO
quarter-hour timetable (:02/:17/:32/:47) instead of the legacy hand-written
schedule that accidentally omitted a number of real draws.
"""
import asyncio

import full20_stoloto_sync as sync


def full_day_schedule():
    return {
        f"{hour:02d}:{minute:02d}"
        for hour in range(24)
        for minute in (2, 17, 32, 47)
    }


sync.SCHEDULE = full_day_schedule()


if __name__ == "__main__":
    asyncio.run(sync.main())
