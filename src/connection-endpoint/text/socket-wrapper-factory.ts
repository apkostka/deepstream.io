import { TOPIC, CONNECTION_ACTION, ParseResult, Message } from '../../constants'
import * as textMessageBuilder from './protocol/message-builder'
import * as textMessageParse from './protocol/message-parser'
import { WebSocketServerConfig } from '../websocket/connection-endpoint'
import { SocketConnectionEndpoint, StatefulSocketWrapper, DeepstreamServices, UnauthenticatedSocketWrapper, SocketWrapper, EVENT } from '../../../ds-types/src/index'
import * as WebSocket from 'ws'

/**
 * This class wraps around a websocket
 * and provides higher level methods that are integrated
 * with deepstream's message structure
 */
export class TextWSSocketWrapper implements UnauthenticatedSocketWrapper {

  public isRemote: false = false
  public isClosed: boolean = false
  public user: string | null = null
  public uuid: number = Math.random()
  public authCallback: Function | null = null
  public authAttempts: number = 0

  private bufferedWrites: string[] = []
  private closeCallbacks: Set<Function> = new Set()

  public authData: object | null = null
  public clientData: object | null = null
  private bufferedWritesTotalByteSize: number = 0

  constructor (
    private socket: WebSocket,
    private handshakeData: any,
    private services: DeepstreamServices,
    private config: WebSocketServerConfig,
    private connectionEndpoint: SocketConnectionEndpoint
   ) {
  }

  get isOpen () {
    return this.isClosed !== true
  }

  /**
   * Called by the connection endpoint to flush all buffered writes.
   * A buffered write is a write that is not a high priority, such as an ack
   * and can wait to be bundled into another message if necessary
   */
  public flush () {
    if (this.bufferedWritesTotalByteSize !== 0) {
      this.bufferedWrites.forEach((bw) => this.socket.send(bw))
      this.bufferedWritesTotalByteSize = 0
      this.bufferedWrites = []
    }
  }

  /**
   * Sends a message based on the provided action and topic
   */
  public sendMessage (message: { topic: TOPIC, action: CONNECTION_ACTION } | Message, allowBuffering: boolean = true): void {
    this.services.monitoring.onMessageSend(message)
    this.sendBuiltMessage(textMessageBuilder.getMessage(message, false), allowBuffering)
  }

  /**
   * Sends a message based on the provided action and topic
   */
  public sendAckMessage (message: Message, allowBuffering: boolean = true): void {
    this.services.monitoring.onMessageSend(message)
    this.sendBuiltMessage(
      textMessageBuilder.getMessage(message, true),
      true
    )
  }

  public getMessage (message: Message): string {
    return textMessageBuilder.getMessage(message, false)
  }

  public parseMessage (message: string): ParseResult[] {
    return textMessageParse.parse(message)
  }

  public parseData (message: Message): true | Error {
    return textMessageParse.parseData(message)
  }

  public onMessage (messages: Message[]): void {
  }

  /**
   * Destroys the socket. Removes all deepstream specific
   * logic and closes the connection
   */
  public destroy (): void {
    this.socket.close()
  }

  public close (): void {
    this.isClosed = true
    delete this.authCallback

    this.closeCallbacks.forEach((cb) => cb(this))
    this.services.logger.info(EVENT.CLIENT_DISCONNECTED, this.user!)
  }

  /**
   * Returns a map of parameters that were collected
   * during the initial http request that established the
   * connection
   */
  public getHandshakeData (): any {
    return this.handshakeData
  }

  public onClose (callback: (socketWrapper: StatefulSocketWrapper) => void): void {
    this.closeCallbacks.add(callback)
  }

  public removeOnClose (callback: (socketWrapper: StatefulSocketWrapper) => void): void {
    this.closeCallbacks.delete(callback)
  }

  public sendBuiltMessage (message: string, buffer?: boolean): void {
    if (this.isOpen) {
      if (this.config.outgoingBufferTimeout === 0) {
        this.socket.send(message)
      } else if (!buffer) {
        this.flush()
        this.socket.send(message)
      } else {
        this.bufferedWritesTotalByteSize += message.length
        this.bufferedWrites.push(message)
        if (this.bufferedWritesTotalByteSize > this.config.maxBufferByteSize) {
          this.flush()
        } else {
          this.connectionEndpoint.scheduleFlush(this as SocketWrapper)
        }
      }
    }
  }
}

export const createWSSocketWrapper = function (
  socket: any,
  handshakeData: any,
  services: DeepstreamServices,
  config: WebSocketServerConfig,
  connectionEndpoint: SocketConnectionEndpoint,
) { return new TextWSSocketWrapper(socket, handshakeData, services, config, connectionEndpoint) }
