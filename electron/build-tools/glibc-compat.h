// Wymuszone (-include) przy budowie node-pty: nowy glibc (2.42+) eksportuje cfsetospeed/cfsetispeed
// w nowej wersji symbolu, przez co pty.node nie ładuje się na starszych dystrybucjach.
// Przypinamy je do wersji z x86_64 (2.2.5), którą ma każdy glibc.
#if defined(__x86_64__)
__asm__(".symver cfsetospeed,cfsetospeed@GLIBC_2.2.5");
__asm__(".symver cfsetispeed,cfsetispeed@GLIBC_2.2.5");
#endif
