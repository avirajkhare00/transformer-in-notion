args = argv ();
if (numel (args) < 1)
  error ("usage: octave-cli sudoku-benchmark.m <out-dir>");
endif

out_dir = args{1};
if (! exist (out_dir, "dir"))
  mkdir (out_dir);
endif

graphics_toolkit ("gnuplot");
set (0, "defaultfigurevisible", "off");

labels = {"Imitation", "Regret"};
branch_decisions = [7523, 5133];
backtracks = [86376, 57057];
wall_time = [96.99, 64.94];

fig = figure ("visible", "off", "color", "white", "position", [100, 100, 1320, 360]);

subplot (1, 3, 1);
bar (branch_decisions, 0.5, "facecolor", [0.20 0.45 0.86]);
set (gca, "xtick", 1:2, "xticklabel", labels, "fontsize", 10);
title ("Branch decisions");
ylabel ("count");
grid on;

subplot (1, 3, 2);
bar (backtracks, 0.5, "facecolor", [0.92 0.50 0.16]);
set (gca, "xtick", 1:2, "xticklabel", labels, "fontsize", 10);
title ("Backtracks");
ylabel ("count");
grid on;

subplot (1, 3, 3);
bar (wall_time, 0.5, "facecolor", [0.13 0.55 0.13]);
set (gca, "xtick", 1:2, "xticklabel", labels, "fontsize", 10);
title ("Wall time");
ylabel ("seconds");
grid on;

set (fig, "paperunits", "inches");
set (fig, "paperposition", [0, 0, 11, 3.2]);
set (fig, "papersize", [11, 3.2]);

print (fig, fullfile (out_dir, "sudoku-benchmark.pdf"), "-dpdfcairo");
print (fig, fullfile (out_dir, "sudoku-benchmark.svg"), "-dsvg");
close (fig);
exit (0);
