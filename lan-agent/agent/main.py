import asyncio

from agent.tunnel import TunnelAgent
from config.settings import Settings


def main():
    settings = Settings()
    agent = TunnelAgent(settings)
    asyncio.run(agent.start())


if __name__ == "__main__":
    main()
