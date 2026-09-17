"""Small in-process event broker used by the Inbox SSE endpoint.

MongoDB remains the source of truth.  SSE is only an invalidation/notification
channel, so reconnecting clients can always reload the canonical conversation.
"""

import asyncio
from collections import defaultdict
from typing import Any, Dict, Set


class InboxEventBroker:
    def __init__(self) -> None:
        self._subscribers: Dict[str, Set[asyncio.Queue]] = defaultdict(set)

    def subscribe(self, workspace_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._subscribers[workspace_id].add(queue)
        return queue

    def unsubscribe(self, workspace_id: str, queue: asyncio.Queue) -> None:
        subscribers = self._subscribers.get(workspace_id)
        if not subscribers:
            return
        subscribers.discard(queue)
        if not subscribers:
            self._subscribers.pop(workspace_id, None)

    async def publish(self, workspace_id: str, event: Dict[str, Any]) -> None:
        for queue in list(self._subscribers.get(workspace_id, set())):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(event)


inbox_events = InboxEventBroker()
