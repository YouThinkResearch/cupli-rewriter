class LRUNode<K, V> {
  constructor(
    public key: K,
    public value: V,
    public prev: LRUNode<K, V> | null = null,
    public next: LRUNode<K, V> | null = null,
  ) { }
}

export class LRUCache<K, V> {
  private capacity: number
  private cache: Map<K, LRUNode<K, V>>
  private head: LRUNode<K, V> | null = null
  private tail: LRUNode<K, V> | null = null

  constructor(capacity: number) {
    this.capacity = capacity
    this.cache = new Map()
  }

  get(key: K): V | undefined {
    const node = this.cache.get(key)
    if (!node)
      return undefined

    // Move to front (most recently used)
    this.moveToFront(node)
    return node.value
  }

  set(key: K, value: V): void {
    const existingNode = this.cache.get(key)

    if (existingNode) {
      // Update existing node
      existingNode.value = value
      this.moveToFront(existingNode)
      return
    }

    // Create new node
    const newNode = new LRUNode(key, value)
    this.cache.set(key, newNode)

    // Add to front
    if (!this.head) {
      this.head = this.tail = newNode
    }
    else {
      newNode.next = this.head
      this.head.prev = newNode
      this.head = newNode
    }

    // Check capacity and evict if necessary
    if (this.cache.size > this.capacity) {
      this.evictLRU()
    }
  }

  has(key: K): boolean {
    return this.cache.has(key)
  }

  delete(key: K): boolean {
    const node = this.cache.get(key)
    if (!node)
      return false

    this.removeNode(node)
    this.cache.delete(key)
    return true
  }

  clear(): void {
    this.cache.clear()
    this.head = null
    this.tail = null
  }

  get size(): number {
    return this.cache.size
  }

  private moveToFront(node: LRUNode<K, V>): void {
    if (node === this.head)
      return

    // Remove from current position
    this.removeNode(node)

    // Add to front
    node.next = this.head
    node.prev = null
    if (this.head) {
      this.head.prev = node
    }
    this.head = node

    if (!this.tail) {
      this.tail = node
    }
  }

  private removeNode(node: LRUNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next
    }
    else {
      this.head = node.next
    }

    if (node.next) {
      node.next.prev = node.prev
    }
    else {
      this.tail = node.prev
    }
  }

  private evictLRU(): void {
    if (!this.tail)
      return

    const lruNode = this.tail
    this.removeNode(lruNode)
    this.cache.delete(lruNode.key)
  }
}
