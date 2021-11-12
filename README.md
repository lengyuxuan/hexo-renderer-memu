### 1. 管道

所有式样的 Unix 都提供管道，它由 `pipe` 函数创建，提供一个单项数据流:

```c
#include <unistd.h>
int pipe(int fd[2]);
```

函数生成两个文件描述符，`fd[0]` 打开来读，`fd[1]` 打开来写。

典型的用途是为父子进程提供一种通信手段，首先父进程创建一个管道：

<div style="text-align: center">
  <img src="./images/single-pipe.drawio.svg">
</div>

接着父进程调用 `fork` 派生一个自身的副本：

<div style="text-align: center">
  <img src="./images/single-fork-pipe.drawio.svg">
</div>

最后，父进程关闭读出端，子进程关闭写入端，这样在父子进程之间就提供了一个单向数据流：

<div style="text-align: center">
  <img src="./images/single-fork-close-pipe.drawio.svg">
  <p></p>
</div>

示例程序：

```c { highlight=[12-15,18,18-26,33,29-37] }
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include<sys/wait.h>

struct pipedes {
  int readFd;
  int writeFd;
};

int main() {
  struct pipedes p;
  char buf[10];
  pipe((int*)&p);
  pid_t pid = fork();

  if (pid == 0) {
    close(p.writeFd);
    int readCount;
    do {
      readCount = read(p.readFd, buf, 3);
      buf[readCount] = '\0';
      printf("receive %d \"%s\"\n", readCount, buf);
    } while (readCount > 0 && readCount == 3);
    close(p.readFd);
    return 0;
  }

  close(p.readFd);
  scanf("%s", buf);
  printf("send %s, len: %ld\n", buf, strlen(buf));
  write(p.writeFd, buf, strlen(buf));
  close(p.writeFd);
  printf("write end\n");
  // waitpid会暂时停止进程的执行，直到有信号来到或子进程结束
  waitpid(pid, NULL, 0);
  return 0;
}

// 输入：
// 123456789
// 输出：
// send 123456789, len: 9
// write end
// receive 3 "123"
// receive 3 "456"
// receive 3 "789"
// receive 0 ""
```

**`fork` 函数解释：**

`fork` 会从当前进程派生出一个几乎完全一样的子进程，创建成功后两个进程都会继续执行 `fork()` 之后的下一条指令。有趣的是一个 `fork` 调用会有两个返回值，在父进程中返回值 `pid` 为子进程的进程 id，在子进程中返回值 `pid` 为 `0`。上面的程序中我用高亮将代码分为了三部分，`[12-15]` 运行在 `fork` 之前，是两个进程都有的部分。`[18-26]` 是在 `pid == 0` 时才会执行的，所以可以认为是子进程独有的部分。`[29-37]` 是在 `pid != 0` 时执行的，所以可以认为是父进程独有的部分。


**上面程序中注释掉第 `18` 行，将会发生什么？为什么？**

**答**：进程将会被阻塞住。要找到阻塞的原因首先要知道那些函数可能会导致阻塞，上面代码中有四个函数可能会阻塞：`scanf`、`waitpid`、`read`、`write`，其中 `scanf` 在控制台输入后就不再阻塞了，`write` 函数之后有日志 `write end` 成功打印，所以也没有阻塞在 `write` 上，所以父进程被阻塞在 `waitpid` 上了，而导致阻塞的原因也是因为子进程没有结束。反观子进程，只有 `read` 可能会阻塞住进程，那 `read` 为什么会被阻塞呢？

原因要从管道的原理说起，管道区别于普通文件，它是一种流式结构，流是没有既定长度的，就像有一条河，你可以说河道有多长(相当于流的缓冲区)，但你不能说这条河里的水有多长，因为水是一直在流动的。在河流两端分别有两道闸，`write` 函数控制上游开闸蓄水，`read` 函数控制下游开闸放水，`close` 函数则控制关闭闸门。当管道的 `readFd` 没有被 `read` 读取时，相当于下游阀门关闭，此时一直调用 `write` 向管道的 `writeFd` 写入数据：

```c
int count = 0;
while (1) {
  count += write(p.writeFd, 'a', 1);
}
```

在我的电脑上，`count` 最终为 `65536`，也就是说缓冲区（`PIPE_BUF`）大小为 `65536` 字节。此时因为缓冲区已经写满，`write` 函数将会被阻塞。缓冲区满的时候写入会阻塞，那缓冲区空的时候，读取就会被阻塞了。所以上面的程序子进程被 `read` 阻塞住是正常的，因为缓冲区空了。第 `18` 行主动关闭了写入描述符，`read` 会得到一个文件结束符，结束阻塞。同理，第 `33` 行如果被注释掉程序也会被阻塞住。此时要理清一个问题，一个描述符可以被多个进程持有引用，比如上面程序中的 `writeFd` 同时被父子进程持有，只有当所有进程都不在持有该描述符的引用时，该描述符才会被释放，所以只有当第 `18` 行和第 `33` 行都关闭掉 `writeFd` 时，管道才认为所有的写入端都关闭了，缓冲区内不会再有新的数据，才会给 `read` 返回一个结束符。

#### 1.1 popen

标准 I/O 函数库提供了 `popen` 函数，它创建一个管道并启动另外一个进程，该进程要么从该管道读出标准输入，要么往该管道写入标准输入。

```c {.line-numbers}
#include <stdio.h>

// 若成功返回文件指针，出错则为 NULL
FILE * popen(const char *conmmand, const char *type);

// 若成功则为 shell 的终止状态，出错则为 -1
int pclose(FILE *stream);
```

示例，从标准输入写入文件名，并打印文件内容：

```c {.line-numbers}
#include <stdio.h>
#include <string.h>

#define MAXLEN 30

int main() {
  size_t len;
  char buf[MAXLEN];
  fgets(buf, MAXLEN, stdin);
  len = strlen(buf);
  if (buf[len - 1] == '\n') {
    buf[len - 1] = '\0';
  }
  char cmd[MAXLEN + 4];
  len = snprintf(cmd, MAXLEN + 3, "cat %s", buf);
  // "r" 表示连接标准输出，"w" 表示连接标准输入
  FILE * f = popen(cmd, "r");
  while (fgets(buf, MAXLEN, f) != NULL) {
    fputs(buf, stdout);
  }
  pclose(f);
  return 0;
}
```

### 2. FIFO

管道因为没有名字，所以只能在有一个共同祖先进程的各个进程之间使用。不同于管道，每个 FIFO 有一个路径与之关联，从而允许无亲缘关系的进程访问同一个 FIFO，因此 FIFO 也被称为命名管道 (named pipe)。

```c {.line-numbers}
#include <sys/types.h>
#include <sys/stat.h>

int mkfifo(const char *pathname, mode_t mode);
```

参数 `pathname` 是一个普通的 Unix 路径名，唯一标识了一个 FIFO。参数 `mode` 用于指定文件的权限位，它是由如下图所示的两个常量按位或形成的，权限位常量定义在 `<sys/stat.h>` 中：

| 常量 | 说明 |
| :-: | :-: |
| S_IRUSR | 用户(属主)读 |
| S_IWUSR | 用户(属主)写 |
| S_IRGRP | (属)组成员读 |
| S_IWGRP | (属)组成员写 |
| S_IROTH | 其它用户读 |
| S_IWOTH | 其它用户写 |

`mkfifo` 函数创建的文件默认已隐含指定了 `O_CREATE | O_EXCL` 模式。也就是说要么创建一个新的 FIFO，要么返回一个 `EEXIST` 错误。如果不希望创建一个新的 FIFO，那么应该调用 `open`：

```c {.line-numbers}
#include <fcntl.h>
int open(const char *pathname, int oflag,...);
```

要打开一个已存在的 FIFO 或创建一个新的 FIFO，应先调用 `mkfifo`，再检查它是否返回 EEXIST 错误，若返回错误则改为调用 `open`。

**如果先调用 `open`，当不存在时在调用 `mkfifo` 创建，会发生什么情况？**

**答**：假设有两个进程同时读取同一个 FIFO，一号进程调用 `open`，后发现不存在并通过 `mkfifo` 创建 FIFO，与此同时二号进程刚好先一步完成了 `mkfifo` 调用，一号进程的调用将会失败。
#### 2.1 FIFO 在有血缘关系的进程上使用

假设有这样一个需求，父进程从标准输入读取文件名，然后通过 FIFO1 告知子进程，子进程读取文件内容后将数据通过 FIFO2 父进程，然后父进程将文件内容通过标准输出打印，设计模型如下：

<div style="text-align: center">
  <img src="./images/fifo-fork.drawio.svg">
</div>

```c { highlight=[52,53] }
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>

#define FIFO1 "/tmp/fifo.1"
#define FIFO2 "/tmp/fifo.2"
#define FIFO_MODE (S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH)
#define MAXLEN 300

int main() {
  char buf[MAXLEN];
  if (mkfifo(FIFO1, FIFO_MODE) < 0 && errno != EEXIST) {
    fprintf(stderr, "mkfifo %s %s\n", FIFO1, strerror(errno));
    return -1;
  }
  if (mkfifo(FIFO2, FIFO_MODE) < 0 && errno != EEXIST) {
    fprintf(stderr, "mkfifo %s %s\n", FIFO2, strerror(errno));
    return -1;
  }
  pid_t pid = fork();
  if (pid == 0) {
    int writeFd = open(FIFO2, O_WRONLY, 0);
    int readFd = open(FIFO1, O_RDONLY, 0);
    size_t n = read(readFd, buf, MAXLEN);
    close(readFd);
    buf[n] = '\0';

    int fd = open(buf, O_RDONLY);
    if (fd < 0) {
      write(writeFd, strerror(errno), strlen(strerror(errno)));
      return -1;
    }
    while ((n = read(fd, buf, MAXLEN)) > 0) {
      write(writeFd, buf, n);
    }
    close(fd);
    close(writeFd);
    return 0;
  }

  fgets(buf, MAXLEN, stdin);
  size_t len = strlen(buf);
  if (buf[len - 1] == '\n') {
    len--;
  }

  int readFd = open(FIFO2, O_RDONLY, 0);
  int writeFd = open(FIFO1, O_WRONLY, 0);
  write(writeFd, buf, len);
  ssize_t n;
  while ((n = read(readFd, buf, MAXLEN)) > 0) {
    write(STDOUT_FILENO, buf, n);
  }
  printf("\n");

  close(readFd);
  close(writeFd);
  waitpid(pid, NULL, 0);
  unlink(FIFO1);
  unlink(FIFO2);
  return 0;
}
```

没有正确使用 FIFO 可能会导致进程间死锁，例如调换上图中第 `52` 行和第 `53` 行后，程序将无法工作。要搞清楚这个问题，我们需要了解 `open` 函数的一个特性：**如果当前没有任何进程打开某个 FIFO 来写，那么打开该 FIFO 来读的进程将被阻塞，反之亦然。**为了便于表达，我将上述代码简写如下：

```c {.line-numbers}
// 父进程部分
int readFd = open(FIFO2, O_RDONLY, 0);
int writeFd = open(FIFO1, O_WRONLY, 0);
// 写入文件名
write(writeFd, buf, len);
// 读取子进程返回的文件内容
read(readFd, buf, MAXLEN);

// 子进程部分
int writeFd = open(FIFO2, O_WRONLY, 0);
int readFd = open(FIFO1, O_RDONLY, 0);
// 读取文件名
read(readFd, buf, MAXLEN);
// 将文件内容返回给父进程
write(writeFd, buf, n);
```

假设父进程中的代码比子进程运行的更早一些：
1. 父进程运行到第 `2` 行的时候子进程还没有运行，此时 `FIFO2` 没有其它进程打开来写，于是父进程被阻塞。

2. 子进程启动，第 `10` 行没有触及 `open` 特性所以直接运行通过，但是被阻塞在 `272` 行。与此同时，由于第 `10` 行打开了 `FIFO1` 来写，父进程的阻塞被取消。

3. 父进程运行第 `3` 行后，打开了 `FIFO1` 来写，于是子进程被唤醒。父进程紧接着写入文件名，然后被阻塞在第 `7` 行，因为此时还有没有进程向 `FIFO2` 中写入数据。子进程被唤醒后，从 `FIFO1` 中读取文件名，因为有数据所以不被阻塞，然后将文件内容写入 `FIFO2`，唤醒了父进程，子进程结束。

4. 父进程读取到文件内容。

回到最初问题，如果第 `2`行和第 `3` 行交换，两个进程均打开来写，双双被阻塞。

#### 2.2 FIFO 在无血缘关系的进程上使用

FIFO 与 pipe 最大的区别就是支持在无血缘关系的进程间使用，要修改也非常简单:

```c {.line-numbers}
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>

#define FIFO1 "/tmp/fifo.1"
#define FIFO2 "/tmp/fifo.2"
#define FIFO_MODE (S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH)
#define MAXLEN 300

int main() {
  char buf[MAXLEN];
  if (mkfifo(FIFO1, FIFO_MODE) < 0 && errno != EEXIST) {
    fprintf(stderr, "mkfifo %s %s\n", FIFO1, strerror(errno));
    return -1;
  }
  if (mkfifo(FIFO2, FIFO_MODE) < 0 && errno != EEXIST) {
    fprintf(stderr, "mkfifo %s %s\n", FIFO2, strerror(errno));
    return -1;
  }
  fgets(buf, MAXLEN, stdin);
  size_t len = strlen(buf);
  if (buf[len - 1] == '\n') {
    len--;
  }

  int readFd = open(FIFO2, O_RDONLY, 0);
  int writeFd = open(FIFO1, O_WRONLY, 0);
  write(writeFd, buf, len);
  ssize_t n;
  while ((n = read(readFd, buf, MAXLEN)) > 0) {
    write(STDOUT_FILENO, buf, n);
  }
  printf("\n");

  close(readFd);
  close(writeFd);
  unlink(FIFO1);
  unlink(FIFO2);
  return 0;
}
```

```c {.line-numbers}
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>

#define FIFO1 "/tmp/fifo.1"
#define FIFO2 "/tmp/fifo.2"
#define FIFO_MODE (S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH)
#define MAXLEN 300

int main() {
  char buf[MAXLEN];
  if (mkfifo(FIFO1, FIFO_MODE) < 0 && errno != EEXIST) {
    fprintf(stderr, "mkfifo %s %s\n", FIFO1, strerror(errno));
    return -1;
  }
  if (mkfifo(FIFO2, FIFO_MODE) < 0 && errno != EEXIST) {
    fprintf(stderr, "mkfifo %s %s\n", FIFO2, strerror(errno));
    return -1;
  }
  int writeFd = open(FIFO2, O_WRONLY, 0);
  int readFd = open(FIFO1, O_RDONLY, 0);
  size_t n = read(readFd, buf, MAXLEN);
  close(readFd);
  buf[n] = '\0';

  int fd = open(buf, O_RDONLY);
  if (fd < 0) {
    write(writeFd, strerror(errno), strlen(strerror(errno)));
    return -1;
  }
  while ((n = read(fd, buf, MAXLEN)) > 0) {
    write(writeFd, buf, n);
  }
  close(fd);
  close(writeFd);
  return 0;
}
```

### 3. 管道和 FIFO 的额外属性

对一个描述符进行`open`、`read`、`write`操作时往往会发生阻塞。有两种方法可以将描述符设置为非阻塞的：

1. 调用 `open` 时可指定 `O_NONBLOCK` 标志，例如：

```c
int writeFd = open(FIFO, O_WRONLY | O_NONBLOCK, 0);
```

2. 如果一个描述符已经打开，那么可以调用 `fcntl` 以启用 `O_NONBLOCK`，对于管道来说只能这样，因为调用 `pipe` 时无法指定该标志。使用时先用 `F_GETFD` 获取当前文件的状态标志，将它与 `O_NONBLOCK` 按位或后使用 `F_SETFD` 存储状态。

```c {.line-numbers}
int flags = fcntl(fd, F_GETFD, 0);
if (flags < 0) {
  fprintf(stderr, "F_GETFD error");
}
flags |= O_NONBLOCK;
if (fcntl(fd, F_SETFD, flags) < 0) {
  fprintf(stderr, "F_SETFD error");
}
```

**注：先使用 `F_GETFD` 获取已存在的状态，在此基础上进行修改，否则可能会导致已有的标志位被清除**

假设有 A、B 两个进程，其中 A 进程已经对管道或 FIFO 进行了某些操作，进程 B 在之后对同一管道或 FIFO 执行 `open`、`read`、`write`操作。下图给出了设置 `O_NONBLOCK` 对进程 B 中函数调用的影响。

| 进程 A | 进程 B | 进程 B 标志（默认） | 进程 B 标志（O_NONBLOCK） |
| :-: | :-: | :-: | :-: |
| FIFO 打开来写 | open FIFO 只读 | 直接返回 | 直接返回 |
| FIFO 不是打开来写 | open FIFO 只读 | 阻塞到 FIFO 打开来写 | 直接返回 |
| FIFO 打开来读 | open FIFO 只写 | 直接返回 | 直接返回 |
| FIFO 不是打开来读 | open FIFO 只写 | 阻塞到 FIFO 打开来读 | 返回 ENXIO 错误 |
| 管道或 FIFO 打开来写 | 从空管道或空 FIFO read | 阻塞到管道或 FIFO 中有数据或不再有进程打开来写 | 返回 EAGAIN 错误 |
| 管道或 FIFO 不是打开来写 | 从空管道或空 FIFO read | read 返回 0（文件结束符） | read 返回 0（文件结束符） |
| 管道或 FIFO 不是打开来读 | 往管道或 FIFO write | 给线程产生 SIGPIPE | 给线程产生 SIGPIPE |
| 管道或 FIFO 打开来读 | 往管道或 FIFO write | **见下文** | **见下文** |

关于管道或 FIFO 读写的若干规则：

* 如果请求读出的数据量多于管道或 FIFO 中剩余量，那么将只返回剩余部分，所以在编写代码时要特别注意这一点，防止产生脏数据。

* 如果请求写入的字节数小于等于 `PIPE_BUF`（Posix 要求这个值至少为 512 字节，上文有提到过），那么 `write` 操作保证是原子性的，也就是说如果有两个进程同时向一个管道或 FIFO 中写入数据，系统也可以保证数据不会被混杂，但是如果超过了 `PIPE_BUF` 那么 `write` 操作就不能保证是原子性的了。

* `O_NONBLOCK` 标志对 `write` 操作的原子性没有影响，原子性只由写入字节数是否大于 `PIPE_BUF` 决定。当管道或 FIFO 设置成非阻塞时，`write` 的返回值取决与写入字节数以及该管道或 FIFO 中当前可用空间的大小。

  如果待写入字节数小于等于 `PIPE_BUF`：

  * 如果管道或 FIFO 剩余空间足以存放写入字节数，那么所有数据都会写入。

  * 如果剩余空间不足以存放写入数据，则会立即返回一个 `EAGAIN` 错误，既然进程不希望阻塞，而内核又无法在只接收部分数据的情况下保证写入的原子性，所以它必须返回一个错误来告知进程以后再试。

  如果待写入字节数大于 `PIPE_BUF`：

  * 如果剩余空间不为 0，则能写入多少就写多少，返回值为实际写入字节数。

  * 如果剩余空间为 0，则直接返回 `EAGAIN` 错误。

### FIFO 一对多模型

本节将使用 FIFO 实现一个串行式的 server-client 模型，客户端从标准输入读取文件名，服务端读取该文件后将文件内容返回给客户端。可以同时存在多个客户端，服务端将按照请求顺序逐一处理。

```c { .line-numbers }
// server.c
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>

#define FIFO_SERVER "/tmp/fifo.server"
#define FIFO_MODE (S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH)
#define MAXLEN 300

// 在我电脑上 pid_t 最终指向了 int，占用空间为 4 字节，所以请求包结构前四个字节表示pid，之后的 200 字节为文件名
typedef struct _Request {
  pid_t pid;
  char data[200];
} *Request;

int main() {
  // 创建服务端监听 FIFO
  if (mkfifo(FIFO_SERVER, FIFO_MODE) < 0 && errno != EEXIST) {
    fprintf(stderr, "mkfifo %s %s\n", FIFO_SERVER, strerror(errno));
    return -1;
  }

  // 创建读取端来接收客户端请求，进程刚启动时，会被阻塞在此处，因为当前 FIFO 尚未开启写入端
  int readFd = open(FIFO_SERVER, O_RDONLY);
  // 这里打开一个 FIFO_SERVER 的写入端，保证 read 时不返回结束符，这样即使不存在客户端服务端也不会退出
  int unuseFd = open(FIFO_SERVER, O_WRONLY, 0);

  // 构建请求接收包
  int reqestLength = sizeof(struct _Request);
  Request req = malloc(reqestLength);

  ssize_t n;
  char buf[MAXLEN];
  // 在没有客户端请求时，FIFO_SERVER 为空，此时 read 会被阻塞
  while ((n = read(readFd, req, reqestLength)) > 0) {
    // 打开响应 FIFO，文件内容会通过该 FIFO 返回给客户端。
    sprintf(buf, "/tmp/fifo.%d", req->pid);
    int clientFd = open(buf, O_WRONLY);
    if (clientFd < 0) {
      fprintf(stderr, "open fifo %s error: %s\n", buf, strerror(errno));
      continue;
    }

    // 打开请求文件
    int fd = open(req->data, O_RDONLY);
    if (fd < 0) {
      sprintf(buf, "open file %s error: %s\n", req->data, strerror(errno));
      write(clientFd, buf, strlen(buf));
      continue;
    }

    // 将文件内容发送给客户端
    while ((n = read(fd, buf, MAXLEN))) {
      write(clientFd, buf, n);
    }
    close(fd);
    // 关闭响应 FIFO，否则客户端无法退出
    close(clientFd);
  }
  free(req);
  close(readFd);
  unlink(FIFO_SERVER);
  return 0;
}
```

启动 server 后，可以直接通过 shell 与之交互：

```shell
echo "Hello world" > /test.file

# 创建响应 FIFO，这里假设 pid 为 1
mkfifo /tmp/fifo.1

# 向服务端 FIFO 写入数据，数据格式代码注释中说明了，前四个字节为 pid。我电脑是小端模式，所以构建如下
echo -e -n "\x01\x00\x00\x00/test.file" > /tmp/fifo.server
# -e 表示使能反斜杠转义，这样遇到 \ 就会转义为二进制，\x 为十六进制
# -n 不添加行尾换行标识，因为默认的 echo 会在末尾添加换行

cat /tmp/fifo.1
# out: Hello world
```

当然我们也可以实现一个客户端：

```c { .line-numbers }
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>
#include <stdlib.h>

#define FIFO_SERVER "/tmp/fifo.server"
#define FIFO_MODE (S_IRUSR | S_IWUSR | S_IRGRP | S_IROTH)
#define MAXLEN 300

typedef struct _Request {
  pid_t pid;
  char data[200];
} *Request;

#define REQEST_LENGTH(req) (sizeof(pid_t) + strlen(req->data))

int main() {
  // 构建请求
  Request req = malloc(sizeof(struct _Request));
  fgets(req->data, 200, stdin);
  int len = strlen(req->data);
  if (req->data[len - 1] == '\n') {
    req->data[len - 1] = '\0';
  }
  req->pid = getpid();

  // 创建临时管道
  char buf[MAXLEN];
  sprintf(buf, "/tmp/fifo.%d", req->pid);
  if (mkfifo(buf, FIFO_MODE) < 0 && errno != EEXIST) {
    fprintf(stderr, "mkfifo %s faild: %s\n", FIFO_SERVER, strerror(errno));
    return -1;
  }
  char fifoName[strlen(buf)];
  strcpy(fifoName, buf);

  // 向服务端发送请求
  int serverFd = open(FIFO_SERVER, O_WRONLY);
  write(serverFd, req, REQEST_LENGTH(req));

  // 准备从临时管道中接受数据
  int readFd = open(buf, O_RDONLY);
  if (readFd < 0) {
    free(req);
    unlink(buf);
    fprintf(stderr, "open %s faild: %s\n", buf, strerror(errno));
    return -1;
  }

  ssize_t n;
  while ((n = read(readFd, buf, MAXLEN)) > 0) {
    write(STDOUT_FILENO, buf, n);
  } 

  free(req);
  close(readFd);
  unlink(fifoName);
  close(serverFd);
  return 0;
}
```

#### 拒绝服务型攻击

上面的代码存在一个致命的问题，当客户端发起请求后，却不打开响应 FIFO 的读取端，这样就会导致服务端一直被阻塞在向响应FIFO写入的调用上，后续其它客户端的请求将无法被正常响应，这称为**拒绝服务（Dos）型攻击**。为了避免这种攻击，可以在阻塞部分加一个超时时间，当更好的方案是针对每个客户端 fork 出一个子进程，这样攻击只影响一个子进程，父进程不受影响。当然这也不是万全的方案，恶意客户端仍可以通过发送大量独立请求，将服务器进程数拉满，使得 fork 失败。
